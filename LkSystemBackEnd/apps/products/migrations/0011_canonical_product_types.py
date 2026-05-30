# Generated manually — canonical product/item taxonomy refactor.
#
# Collapses the legacy 5-value product_type enum
#   {resell, packaging, finished, component, raw_material}
# into the canonical 4-value enum
#   {resell_product, pack, component, packaging_item}
#
# This migration is ADDITIVE and NON-DESTRUCTIVE:
#   * It only rewrites the `product_type` string column in place.
#   * No fields are dropped (is_pack / pack_items are kept as-is).
#   * The backfill is data-driven and fully reversible.
#
# Backfill rules (forward):
#   is_pack=True                      -> 'pack'        (a pack is both)
#   'resell'  / 'finished'            -> 'resell_product'   (perfume == resell_product)
#   'component' / 'raw_material'      -> 'component'
#   'packaging' AND used in a BOM     -> 'component'        (real manufacturing component)
#   'packaging' AND NOT used in a BOM -> 'packaging_item'   (real packaging item)
#   anything else / unknown           -> 'resell_product'   (safe default, reported)
#
# The packaging split is the careful part: today some "packaging" products are
# actually BOM components (bottle, cap, label) while others are true packaging
# (shipping box, thank-you card). We disambiguate by BOM membership so existing
# Bills of Materials remain valid under the new "components must be type=component"
# rule and no manufacturing data breaks.

from django.db import migrations, models


NEW_CHOICES = [
    ('resell_product', 'Resell Product'),
    ('pack', 'Pack'),
    ('component', 'Component'),
    ('packaging_item', 'Packaging Item'),
]

OLD_CHOICES = [
    ('resell', 'Resell Product'),
    ('packaging', 'Packaging / Emballage'),
    ('finished', 'Finished Product'),
    ('component', 'Component'),
    ('raw_material', 'Raw Material'),
]


def forward_backfill(apps, schema_editor):
    Product = apps.get_model('products', 'Product')
    BillOfMaterialsItem = apps.get_model('inventory', 'BillOfMaterialsItem')

    # Product ids referenced as a BOM component => these are real components.
    component_ids = set(
        BillOfMaterialsItem.objects.values_list('component_id', flat=True)
    )

    counts = {
        'pack': 0,
        'resell_product': 0,
        'component': 0,
        'packaging_item': 0,
        'packaging_to_component': 0,
        'unknown_to_resell_product': 0,
        'unchanged': 0,
    }
    unknown_examples = []

    # Plain manager in migrations => iterates ALL rows incl. soft-deleted.
    for product in Product.objects.all().iterator():
        old = product.product_type

        if product.is_pack:
            new = 'pack'
        elif old in ('resell', 'finished', 'resell_product'):
            new = 'resell_product'
        elif old in ('component', 'raw_material'):
            new = 'component'
        elif old == 'packaging':
            if product.id in component_ids:
                new = 'component'
                counts['packaging_to_component'] += 1
            else:
                new = 'packaging_item'
        elif old == 'packaging_item':
            new = 'packaging_item'
        else:
            new = 'resell_product'
            counts['unknown_to_resell_product'] += 1
            if len(unknown_examples) < 20:
                unknown_examples.append((product.id, old))

        if new != old:
            product.product_type = new
            product.save(update_fields=['product_type'])
            counts[new] += 1
        else:
            counts['unchanged'] += 1

    # Report (visible in `manage.py migrate` output).
    print('\n[products.0011] product_type backfill report:')
    print(f"    -> pack            : {counts['pack']}")
    print(f"    -> resell_product  : {counts['resell_product']}")
    print(f"    -> component       : {counts['component']}")
    print(f"       (packaging used in a BOM reclassified as component: {counts['packaging_to_component']})")
    print(f"    -> packaging_item  : {counts['packaging_item']}")
    print(f"    unchanged          : {counts['unchanged']}")
    if counts['unknown_to_resell_product']:
        print(
            f"    WARNING: {counts['unknown_to_resell_product']} product(s) had an "
            f"undetectable type and were defaulted to 'resell_product'. "
            f"Examples (id, old_value): {unknown_examples}"
        )


def reverse_backfill(apps, schema_editor):
    """Best-effort reverse to functionally-equivalent legacy values (non-destructive)."""
    Product = apps.get_model('products', 'Product')
    reverse_map = {
        'resell_product': 'resell',
        'pack': 'resell',          # is_pack flag is preserved, so pack logic still works
        'packaging_item': 'packaging',
        'component': 'component',
    }
    for product in Product.objects.all().iterator():
        legacy = reverse_map.get(product.product_type)
        if legacy and legacy != product.product_type:
            product.product_type = legacy
            product.save(update_fields=['product_type'])


class Migration(migrations.Migration):

    dependencies = [
        ('products', '0010_product_categories'),
        # Needed so BillOfMaterialsItem exists for the BOM-aware packaging split.
        ('inventory', '0004_bom_production_batches'),
    ]

    operations = [
        migrations.AlterField(
            model_name='product',
            name='product_type',
            field=models.CharField(
                choices=NEW_CHOICES,
                default='resell_product',
                max_length=20,
                verbose_name='Product Type',
            ),
        ),
        migrations.RunPython(forward_backfill, reverse_backfill),
    ]
