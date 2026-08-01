import { API_CONFIG } from '@/utils/constants';

export type PublicVitrineProductType = 'resell_product' | 'pack';
export type PublicVitrineDiscountType = 'percentage' | 'fixed';

export interface PublicVitrinePromotion {
  id: number;
  name: string;
  discount_type: PublicVitrineDiscountType;
  discount_value: string;
  discounted_price: string;
  savings: string;
}

export interface PublicVitrinePackComponent {
  product_id: number | null;
  name: string;
  barcode: string;
  image_url: string;
  quantity: number;
  unit_price: string;
  line_total: string;
}

export interface PublicVitrineProduct {
  id: number;
  name: string;
  barcode: string;
  image_url: string;
  product_link: string;
  product_type: PublicVitrineProductType;
  is_pack: boolean;
  sales_price: string;
  effective_price: string;
  available_quantity: number;
  is_out_of_stock: boolean;
  category_ids: number[];
  category_names: string[];
  promotion: PublicVitrinePromotion | null;
  pack_components: PublicVitrinePackComponent[];
  pack_components_total: string;
  pack_savings: string;
}

export interface PublicVitrineCategory {
  id: number;
  name: string;
  slug: string;
  display_order: number;
  product_count: number;
}

export interface PublicVitrineSalesChannel {
  id: number;
  name: string;
  code: string | null;
  address: string;
  phone: string;
  state: string;
  brand_id: number;
  brand_name: string;
  brand_logo: string;
}

export interface PublicVitrineResponse {
  sales_channel: PublicVitrineSalesChannel;
  generated_at: string;
  categories: PublicVitrineCategory[];
  products: PublicVitrineProduct[];
}

const buildPublicApiUrl = (path: string) => {
  const base = API_CONFIG.BASE_URL.replace(/\/$/, '');
  return `${base}${path}`;
};

class PublicVitrineService {
  async getPOSVitrine(salesChannelId: number | string): Promise<PublicVitrineResponse> {
    const response = await fetch(
      buildPublicApiUrl(
        `/api/v1/products/public-vitrine/?sales_channel=${encodeURIComponent(String(salesChannelId))}`,
      ),
      {
        method: 'GET',
        credentials: 'omit',
        headers: {
          Accept: 'application/json',
        },
      },
    );

    if (!response.ok) {
      let message = 'Impossible de charger la vitrine.';
      try {
        const payload = await response.json();
        if (payload?.detail) message = payload.detail;
      } catch {
        // Keep the friendly fallback for non-JSON server errors.
      }
      throw new Error(message);
    }

    return response.json();
  }
}

export const publicVitrineService = new PublicVitrineService();
