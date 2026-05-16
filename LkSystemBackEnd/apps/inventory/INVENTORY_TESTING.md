# Testing Inventory Module - Frontend Guide

## Quick Start - Test Without WooCommerce

The WooCommerce error occurs when trying to sync categories from an unreachable store. Here's how to test locally:

### 1. Create Test Data via Django Shell

```bash
docker exec lksystem_web python manage.py shell
```

Then paste this code:

```python
from apps.company.models import Company
from apps.brands.models import Brand
from apps.sales_channels.models import SalesChannel
from apps.products.models import Product
from apps.inventory.models import Store, StoreInventory
from decimal import Decimal

# Company
company, _ = Company.objects.get_or_create(
    name='Test Company',
    defaults={'abbreviation': 'TEST', 'legal_name': 'Test LLC', 'email': 'test@test.com', 'phone': '+216 71 000 000', 'city': 'Tunis'}
)

# Brand
brand, _ = Brand.objects.get_or_create(company=company, name='Test Brand')

# Sales Channel (POS - no WooCommerce)
sc, _ = SalesChannel.objects.get_or_create(
    brand=brand, name='POS', 
    defaults={'channel_type': 'POS', 'is_active': True}
)

# Products
for name, code, price in [('Laptop', 'LAP-001', 999.99), ('Phone', 'PHO-001', 899.99)]:
    Product.objects.get_or_create(
        sales_channel=sc, barcode=code,
        defaults={'name': name, 'wc_product_id': 0, 'slug': name.lower(), 
                  'sales_price': price, 'purchase_price': price * 0.6, 'manage_stock': True}
    )

# Stores
for code, name in [('WH-001', 'Warehouse'), ('STR-001', 'Store')]:
    store, _ = Store.objects.get_or_create(
        company=company, code=code,
        defaults={'name': name, 'store_type': Store.StoreType.WAREHOUSE, 'is_active': True}
    )
    
    for prod in Product.objects.filter(sales_channel=sc):
        StoreInventory.objects.get_or_create(
            store=store, product=prod,
            defaults={'quantity': 100, 'minimum_quantity': 10}
        )

print('✅ Test data created!')
exit()
```

### 2. Test Frontend Features

#### Stores Management
- Navigate to `/inventory/stores`
- View list of created stores (Warehouse, Store)
- Click on a store to see its inventory

#### Store Inventory
- Navigate to `/inventory/inventory`
- View all stock levels across stores
- See product inventory by store with quantities

#### Inventory Movements
- Navigate to `/inventory/movements`
- View movement history (empty initially)
- Create new movements using the API

#### Product Stock Auto-Update
- View any product detail page
- Check `stock_quantity` - it should show sum of all store inventory quantities
- When you update StoreInventory, `Product.stock_quantity` updates automatically

### 3. API Testing (Postman/Thunder Client)

**Get all stores:**
```
GET http://localhost:8000/api/v1/inventory/stores/
```

**Get store inventory:**
```
GET http://localhost:8000/api/v1/inventory/store-inventory/
```

**Create inventory movement:**
```
POST http://localhost:8000/api/v1/inventory/movements/
{
  "store": 1,
  "product": 1,
  "movement_type": "PURCHASE",
  "quantity": 50
}
```

**Create inter-store transfer:**
```
POST http://localhost:8000/api/v1/inventory/movements/transfer/
{
  "source_store": 1,
  "destination_store": 2,
  "product": 1,
  "quantity": 25
}
```

## Avoiding WooCommerce Errors

### Problem
When creating a WooCommerce sales channel, the system tries to auto-fetch categories, which fails if:
- The WooCommerce store URL is unreachable
- Network connectivity is blocked
- Invalid credentials

### Solution
1. **Use POS channels** for local testing (no WooCommerce sync needed)
2. **Skip category sync** - Only sync if you have valid WooCommerce credentials
3. **Test with mock data** - Create categories/products manually instead

### If You Must Use WooCommerce
1. Ensure valid credentials:
   ```
   store_url: https://yourstore.com
   consumer_key: ck_xxxxx
   consumer_secret: cs_xxxxx
   ```
2. Use the preview endpoint first to troubleshoot:
   ```
   POST /api/v1/categories/preview/
   {"sales_channel": 1}
   ```

## Frontend Components to Implement

### Inventory Pages (Optional)
You can create React pages to display inventory:

1. **`StorePage.tsx`** - List and manage stores
2. **`StoreInventoryPage.tsx`** - View/edit stock levels
3. **`InventoryMovementsPage.tsx`** - Track movements and transfers
4. **`StockAdjustmentDialog.tsx`** - Quick stock adjustments

### Example Usage in React
```tsx
import { useStores, useStoreInventories, useAdjustStock } from '@/hooks/queries';

function InventoryDashboard() {
  const {data: stores} = useStores();
  const {data: inventories} = useStoreInventories();
  const adjustMutation = useAdjustStock();

  return (
    <div>
      <h1>Stores: {stores?.length}</h1>
      <h2>Total SKUs: {inventories?.length}</h2>
      
      {inventories?.map(inv => (
        <div key={inv.id}>
          {inv.product_name} @ {inv.store_name}: {inv.quantity} units
        </div>
      ))}
    </div>
  );
}
```

## Database Structure

### Store Model
- **name**: Store/warehouse name
- **code**: Unique identifier (WH-001, STR-TUN)
- **store_type**: WAREHOUSE, RETAIL, DISTRIBUTION
- **is_default**: Used for default store selection
- **is_active**: Enable/disable store

### StoreInventory Model
- **Links**: Store + Product
- **quantity**: Current stock
- **reserved_quantity**: Allocated to orders
- **available_quantity**: quantity - reserved (auto-calculated)
- **minimum_quantity**: Reorder point
- **bin_location**: Shelf location

### InventoryMovement Model
- **Types**: PURCHASE, SALE, TRANSFER, ADJUSTMENT, DAMAGE, RETURN
- **Status**: PENDING, COMPLETED, CANCELLED
- **Auto-increment**: stock_quantity when COMPLETED

## Key Features

✅ **Automatic Stock Calculation** - Product.stock_quantity = SUM(StoreInventory.quantity)
✅ **Multi-Store Support** - Track inventory across multiple locations
✅ **Movement Audit Trail** - Full history with reference numbers
✅ **Inter-Store Transfers** - Automatic paired movements
✅ **Stock Alerts** - Low/out-of-stock detection
✅ **Cost Tracking** - Purchase price, totals, margins

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "WooCommerce unreachable" | Use POS channel instead of WOOCOMMERCE |
| Product stock_quantity not updating | Check StoreInventory records exist for that product |
| Inventory movements not completing | Movements must be explicitly completed via API |
| Transfer creates duplicate inventory |  This is expected - transfer_out reduces source, transfer_in increases destination |

---

**Happy Testing!** 🚀
