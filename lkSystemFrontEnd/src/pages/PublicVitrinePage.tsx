import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Box,
  ChevronRight,
  Loader2,
  Package,
  Search,
  Sparkles,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getMediaUrl } from '@/utils/helpers';
import {
  publicVitrineService,
  type PublicVitrineCategory,
  type PublicVitrinePackComponent,
  type PublicVitrineProduct,
  type PublicVitrineResponse,
} from '@/services/publicVitrine.service';

type ProductTypeFilter = 'all' | 'resell_product' | 'pack';
type CategoryFilter = 'all' | 'uncategorized' | string;

const MARKETING_SITE_URL = 'https://therapybylk.com/';

function formatTND(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return '0.000 TND';
  return `${amount.toFixed(3)} TND`;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function isPackProduct(product: PublicVitrineProduct) {
  return product.product_type === 'pack' || product.is_pack;
}

function productMatchesCategory(product: PublicVitrineProduct, category: CategoryFilter) {
  if (category === 'all') return true;
  if (category === 'uncategorized') return product.category_ids.length === 0;
  return product.category_ids.includes(Number(category));
}

function promotionLabel(product: PublicVitrineProduct) {
  if (!product.promotion) return null;
  const value = Number(product.promotion.discount_value);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (product.promotion.discount_type === 'percentage') {
    return `${Math.round(value)}% OFF`;
  }
  return `-${formatTND(value)}`;
}

function ProductImage({
  src,
  alt,
  className = '',
}: {
  src?: string | null;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const resolved = getMediaUrl(src);

  if (!resolved || failed) {
    return (
      <div className={`flex items-center justify-center bg-neutral-100 text-neutral-300 ${className}`}>
        <Package className="h-12 w-12" />
      </div>
    );
  }

  return (
    <img
      src={resolved}
      alt={alt}
      className={`bg-neutral-100 object-cover ${className}`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function ProductTile({
  product,
  salesChannelId,
}: {
  product: PublicVitrineProduct;
  salesChannelId: string;
}) {
  const navigate = useNavigate();
  const label = promotionLabel(product);
  const hasDiscount = Number(product.effective_price) < Number(product.sales_price);
  const isPack = isPackProduct(product);

  return (
    <button
      type="button"
      className="group min-w-0 text-left focus:outline-none"
      onClick={() => navigate(`/vitrine/${salesChannelId}/product/${product.id}`)}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-neutral-100 md:aspect-square">
        <ProductImage
          src={product.image_url}
          alt={product.name}
          className="h-full w-full transition duration-300 group-hover:scale-[1.03]"
        />

        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
          {product.is_out_of_stock ? (
            <span className="bg-red-600 px-2 py-1 text-[11px] font-black uppercase tracking-tight text-white">
              Épuisé
            </span>
          ) : label ? (
            <span className="bg-black px-2 py-1 text-[11px] font-black uppercase tracking-tight text-white">
              {label}
            </span>
          ) : null}
          {isPack && (
            <span className="bg-white px-2 py-1 text-[11px] font-black uppercase tracking-tight text-black shadow-sm">
              Pack
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-1">
        <h3 className="line-clamp-2 min-h-[2.75rem] text-base font-semibold uppercase leading-snug tracking-normal text-neutral-950 md:text-lg">
          {product.name}
        </h3>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-base font-black text-neutral-950 md:text-lg">
            {formatTND(product.effective_price)}
          </span>
          {hasDiscount && (
            <span className="text-sm text-neutral-500 line-through">
              {formatTND(product.sales_price)}
            </span>
          )}
        </div>
        {isPack && Number(product.pack_savings) > 0 && (
          <p className="text-sm font-semibold text-neutral-700">
            Vous économisez {formatTND(product.pack_savings)}
          </p>
        )}
      </div>
    </button>
  );
}

function CategoryButton({
  category,
  active,
  onClick,
}: {
  category: PublicVitrineCategory | { id: CategoryFilter; name: string; product_count: number };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center gap-3 border-b-2 px-1 py-3 text-left transition ${
        active
          ? 'border-black text-black'
          : 'border-transparent text-neutral-500 hover:border-neutral-300 hover:text-black'
      }`}
    >
      <span className="text-sm font-black uppercase tracking-normal md:text-base">
        {category.name}
      </span>
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-bold ${
          active ? 'bg-black text-white' : 'bg-neutral-100 text-neutral-600'
        }`}
      >
        {category.product_count}
      </span>
    </button>
  );
}

function PackComponentRow({
  component,
  canOpen,
  onOpen,
}: {
  component: PublicVitrinePackComponent;
  canOpen: boolean;
  onOpen: () => void;
}) {
  const content = (
    <>
      <ProductImage
        src={component.image_url}
        alt={component.name}
        className="h-14 w-14"
      />
      <div className="min-w-0">
        <p className="line-clamp-2 text-sm font-bold uppercase">
          {component.name}
        </p>
        <p className="text-xs text-neutral-500">
          Qté {component.quantity}
        </p>
      </div>
      <div className="flex items-center justify-end gap-2">
        <p className="text-sm font-black">
          {formatTND(component.line_total)}
        </p>
        {canOpen && <ChevronRight className="h-4 w-4 text-neutral-400" />}
      </div>
    </>
  );

  const className =
    'grid w-full grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left';

  if (!canOpen) {
    return <div className={className}>{content}</div>;
  }

  return (
    <button
      type="button"
      className={`${className} transition hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black`}
      onClick={onOpen}
      aria-label={`Voir ${component.name}`}
    >
      {content}
    </button>
  );
}

function ProductDetailOverlay({
  product,
  data,
  salesChannelId,
  onClose,
}: {
  product: PublicVitrineProduct;
  data: PublicVitrineResponse;
  salesChannelId: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const label = promotionLabel(product);
  const hasDiscount = Number(product.effective_price) < Number(product.sales_price);
  const isPack = isPackProduct(product);
  const catalogueProductIds = useMemo(
    () => new Set(data.products.map(row => row.id)),
    [data.products],
  );

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-white text-neutral-950">
      <header className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1680px] items-center justify-between gap-4 px-4 py-4 md:px-8">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-2 text-sm font-black uppercase tracking-normal"
          >
            <ArrowLeft className="h-5 w-5" />
            Retour
          </button>
          <div className="min-w-0 text-center">
            <p className="truncate text-xs font-bold uppercase text-neutral-500">
              {data.sales_channel.name}
            </p>
            <p className="truncate text-sm font-black uppercase md:text-base">
              Détail produit
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 place-items-center border border-neutral-200 text-black transition hover:bg-black hover:text-white"
            aria-label="Fermer"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1680px] gap-8 px-4 py-6 md:px-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.75fr)] lg:py-10">
        <ProductImage
          src={product.image_url}
          alt={product.name}
          className="aspect-square h-auto w-full"
        />

        <section className="min-w-0 space-y-6">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {product.is_out_of_stock ? (
                <Badge className="rounded-none bg-red-600 text-white hover:bg-red-600">
                  Épuisé
                </Badge>
              ) : (
                <Badge variant="outline" className="rounded-none">
                  Stock {product.available_quantity}
                </Badge>
              )}
              {isPack && (
                <Badge className="rounded-none bg-black text-white hover:bg-black">
                  Pack
                </Badge>
              )}
              {label && (
                <Badge className="rounded-none bg-black text-white hover:bg-black">
                  {label}
                </Badge>
              )}
            </div>

            <h1 className="vitrine-display text-4xl font-black uppercase leading-[0.95] tracking-normal md:text-6xl">
              {product.name}
            </h1>

            <div className="flex flex-wrap items-end gap-3">
              <span className="text-3xl font-black md:text-5xl">
                {formatTND(product.effective_price)}
              </span>
              {hasDiscount && (
                <span className="pb-1 text-lg font-semibold text-neutral-500 line-through">
                  {formatTND(product.sales_price)}
                </span>
              )}
            </div>
          </div>

          {isPack && (
            <div className="border border-neutral-200">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div>
                  <p className="font-black uppercase">Composition du pack</p>
                  <p className="text-sm text-neutral-500">
                    Valeur séparée: {formatTND(product.pack_components_total)}
                  </p>
                </div>
                {Number(product.pack_savings) > 0 && (
                  <div className="bg-black px-3 py-2 text-right text-white">
                    <p className="text-[11px] font-bold uppercase">Gain client</p>
                    <p className="font-black">{formatTND(product.pack_savings)}</p>
                  </div>
                )}
              </div>
              <div className="divide-y">
                {product.pack_components.map(component => {
                  const componentId = component.product_id;
                  const canOpen = Boolean(componentId && catalogueProductIds.has(componentId));

                  return (
                    <PackComponentRow
                      key={`${component.product_id}-${component.name}`}
                      component={component}
                      canOpen={canOpen}
                      onOpen={() => {
                        if (!componentId) return;
                        navigate(`/vitrine/${salesChannelId}/product/${componentId}`);
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid gap-3 border border-neutral-200 p-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-bold uppercase text-neutral-500">Catégorie</p>
              <p className="mt-1 font-bold">
                {product.category_names.join(', ') || 'Sans catégorie'}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-neutral-500">Code-barres</p>
              <p className="mt-1 font-bold">{product.barcode || '-'}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-neutral-500">Point de vente</p>
              <p className="mt-1 font-bold">{data.sales_channel.name}</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default function PublicVitrinePage() {
  const { salesChannelId = '', productId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<PublicVitrineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');
  const [typeFilter, setTypeFilter] = useState<ProductTypeFilter>('all');

  useEffect(() => {
    if (!salesChannelId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    publicVitrineService
      .getPOSVitrine(salesChannelId)
      .then(payload => {
        if (!cancelled) setData(payload);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Impossible de charger la vitrine.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [salesChannelId]);

  const categoryTabs = useMemo(() => {
    if (!data) return [];
    const uncategorizedCount = data.products.filter(product => product.category_ids.length === 0).length;
    const tabs: Array<PublicVitrineCategory | { id: CategoryFilter; name: string; product_count: number }> = [
      { id: 'all', name: 'Tous', product_count: data.products.length },
      ...data.categories,
    ];
    if (uncategorizedCount > 0) {
      tabs.push({ id: 'uncategorized', name: 'Autres', product_count: uncategorizedCount });
    }
    return tabs;
  }, [data]);

  const categoryProducts = useMemo(() => {
    if (!data) return [];
    return data.products.filter(product => productMatchesCategory(product, activeCategory));
  }, [activeCategory, data]);

  const productCounts = useMemo(() => {
    return categoryProducts.reduce(
      (acc, product) => {
        acc.all += 1;
        if (isPackProduct(product)) acc.pack += 1;
        else acc.resell_product += 1;
        return acc;
      },
      { all: 0, resell_product: 0, pack: 0 },
    );
  }, [categoryProducts]);

  useEffect(() => {
    if (typeFilter !== 'all' && productCounts[typeFilter] === 0) {
      setTypeFilter('all');
    }
  }, [productCounts, typeFilter]);

  const filteredProducts = useMemo(() => {
    const query = normalize(search);

    return categoryProducts
      .filter(product => {
        if (typeFilter !== 'all') {
          const productKind = isPackProduct(product) ? 'pack' : 'resell_product';
          if (productKind !== typeFilter) return false;
        }

        if (!query) return true;
        const haystack = [
          product.name,
          product.barcode,
          ...product.category_names,
          ...product.pack_components.map(component => component.name),
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => {
        if (a.is_out_of_stock !== b.is_out_of_stock) return a.is_out_of_stock ? 1 : -1;
        const aPromo = Boolean(a.promotion);
        const bPromo = Boolean(b.promotion);
        if (aPromo !== bPromo) return aPromo ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [categoryProducts, search, typeFilter]);

  const selectedProduct = useMemo(() => {
    if (!data || !productId) return null;
    return data.products.find(product => String(product.id) === String(productId)) ?? null;
  }, [data, productId]);

  if (loading) {
    return (
      <main className="public-vitrine-page flex min-h-screen items-center justify-center bg-white text-black">
        <div className="flex items-center gap-3 text-sm font-black uppercase">
          <Loader2 className="h-5 w-5 animate-spin" />
          Chargement de la vitrine
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="public-vitrine-page flex min-h-screen items-center justify-center bg-white px-4 text-black">
        <div className="max-w-md border border-neutral-200 p-6 text-center">
          <AlertCircle className="mx-auto h-9 w-9" />
          <h1 className="mt-4 text-2xl font-black uppercase">Vitrine indisponible</h1>
          <p className="mt-2 text-sm text-neutral-600">{error}</p>
          <Button className="mt-5 rounded-none" onClick={() => window.location.reload()}>
            Réessayer
          </Button>
        </div>
      </main>
    );
  }

  const activeCategoryName =
    categoryTabs.find(category => String(category.id) === String(activeCategory))?.name || data.sales_channel.brand_name;

  return (
    <main className="public-vitrine-page min-h-screen bg-white text-neutral-950">
      <header className="sticky top-0 z-30 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-3 px-4 py-4 md:px-8 lg:px-12">
          <button
            type="button"
            className="grid h-12 w-12 shrink-0 place-items-center text-black md:h-16 md:w-16"
            onClick={() => window.history.back()}
            aria-label="Retour"
          >
            <ChevronRight className="h-10 w-10 rotate-180 stroke-[3] md:h-16 md:w-16" />
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="vitrine-display truncate text-4xl font-black uppercase leading-none tracking-normal md:text-7xl">
              {activeCategoryName}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold uppercase text-neutral-500 md:text-sm">
              <span>{data.sales_channel.name}</span>
              {data.sales_channel.state && <span>{data.sales_channel.state}</span>}
              <span>{data.products.length} produits</span>
            </div>
          </div>

          <a
            href={MARKETING_SITE_URL}
            className="grid h-12 w-12 shrink-0 place-items-center text-black transition hover:bg-black hover:text-white md:h-16 md:w-16"
            aria-label="Fermer la vitrine"
          >
            <X className="h-9 w-9 stroke-[3] md:h-12 md:w-12" />
          </a>
        </div>
      </header>

      <section className="border-b bg-white">
        <div className="mx-auto max-w-[1800px] px-4 md:px-8 lg:px-12">
          <div className="flex gap-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {categoryTabs.map(category => (
              <CategoryButton
                key={String(category.id)}
                category={category}
                active={String(activeCategory) === String(category.id)}
                onClick={() => setActiveCategory(String(category.id))}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1800px] px-4 py-4 md:px-8 lg:px-12">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-500" />
            <Input
              className="h-12 rounded-none border-neutral-300 pl-12 text-base shadow-none focus-visible:ring-black"
              placeholder="Recherche rapide: produit, pack, code-barres..."
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-3 border border-neutral-200">
            {[
              ['all', 'Tous', productCounts.all],
              ['resell_product', 'Produits', productCounts.resell_product],
              ['pack', 'Packs', productCounts.pack],
            ].map(([value, label, count]) => (
              <button
                key={String(value)}
                type="button"
                onClick={() => setTypeFilter(value as ProductTypeFilter)}
                disabled={value !== 'all' && Number(count) === 0}
                className={`min-w-24 px-3 py-3 text-xs font-black uppercase transition md:min-w-32 ${
                  typeFilter === value
                    ? 'bg-black text-white'
                    : Number(count) === 0 && value !== 'all'
                      ? 'cursor-not-allowed bg-neutral-50 text-neutral-300'
                      : 'bg-white text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                {label}
                <span className="ml-2 opacity-70">{count}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1800px] px-4 pb-14 md:px-8 lg:px-12">
        {filteredProducts.length === 0 ? (
          <div className="grid min-h-[40vh] place-items-center border border-dashed border-neutral-300 text-center">
            <div>
              <Search className="mx-auto h-9 w-9 text-neutral-400" />
              <p className="mt-3 text-lg font-black uppercase">Aucun produit trouvé</p>
              <p className="mt-1 text-sm text-neutral-500">Essayez une autre catégorie ou recherche.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-5 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {filteredProducts.map(product => (
              <ProductTile
                key={product.id}
                product={product}
                salesChannelId={salesChannelId}
              />
            ))}
          </div>
        )}
      </section>

      <div className="fixed bottom-4 right-4 z-20 hidden items-center gap-2 bg-black px-4 py-3 text-sm font-black uppercase text-white shadow-lg md:flex">
        <Sparkles className="h-4 w-4" />
        {data.sales_channel.name}
      </div>

      {selectedProduct && (
        <ProductDetailOverlay
          key={selectedProduct.id}
          product={selectedProduct}
          data={data}
          salesChannelId={salesChannelId}
          onClose={() => navigate(`/vitrine/${salesChannelId}`)}
        />
      )}

      {productId && !selectedProduct && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-white px-4 text-center">
          <div className="max-w-sm border border-neutral-200 p-6">
            <Box className="mx-auto h-10 w-10" />
            <p className="mt-3 text-xl font-black uppercase">Produit introuvable</p>
            <Button
              className="mt-5 rounded-none"
              onClick={() => navigate(`/vitrine/${salesChannelId}`)}
            >
              Retour à la vitrine
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
