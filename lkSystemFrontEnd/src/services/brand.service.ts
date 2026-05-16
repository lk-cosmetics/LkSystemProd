/**
 * Brand Service
 * Handles all brand-related API calls
 */

import { apiClient } from './axios';
import type {
  Brand,
  CreateBrandRequest,
  PaginatedResponse,
  SalesChannel,
} from '@/types';
import { AUTH_CONFIG } from '@/utils/constants';

interface BrandQueryParams {
  company?: number;
  search?: string;
  ordering?: string;
}

class BrandService {
  /**
   * Get all brands (handles paginated response)
   */
  async getAllBrands(params?: BrandQueryParams): Promise<Brand[]> {
    const response = await apiClient.get<PaginatedResponse<Brand>>(
      AUTH_CONFIG.BRAND_ENDPOINT,
      { params }
    );
    // Handle paginated response - extract results array
    if (response.data && 'results' in response.data) {
      return response.data.results;
    }
    // Fallback for non-paginated response
    return response.data as unknown as Brand[];
  }

  /**
   * Get brands by company ID
   */
  async getBrandsByCompany(companyId: number): Promise<Brand[]> {
    return this.getAllBrands({ company: companyId });
  }

  /**
   * Get brand by ID
   */
  async getBrandById(id: number): Promise<Brand> {
    const response = await apiClient.get<Brand>(
      `${AUTH_CONFIG.BRAND_ENDPOINT}${id}/`
    );
    return response.data;
  }

  /**
   * Get brand's sales channels
   */
  async getBrandChannels(id: number): Promise<SalesChannel[]> {
    const response = await apiClient.get<SalesChannel[]>(
      `${AUTH_CONFIG.BRAND_ENDPOINT}${id}/channels/`
    );
    return response.data;
  }

  /**
   * Create new brand
   */
  async createBrand(data: CreateBrandRequest): Promise<Brand> {
    // Check if there's a file to upload
    const hasFile = data.logo instanceof File;

    if (hasFile) {
      const formData = new FormData();
      formData.append('company', String(data.company));
      formData.append('name', data.name);
      if (data.logo) {
        formData.append('logo', data.logo);
      }

      // Content-Type is auto-set by axios interceptor for FormData
      const response = await apiClient.post<Brand>(
        AUTH_CONFIG.BRAND_ENDPOINT,
        formData
      );
      return response.data;
    } else {
      // Use JSON for non-file requests
      const response = await apiClient.post<Brand>(AUTH_CONFIG.BRAND_ENDPOINT, {
        company: data.company,
        name: data.name,
      });
      return response.data;
    }
  }

  /**
   * Update brand (full update)
   */
  async updateBrand(id: number, data: CreateBrandRequest): Promise<Brand> {
    const hasFile = data.logo instanceof File;

    if (hasFile) {
      const formData = new FormData();
      formData.append('company', String(data.company));
      formData.append('name', data.name);
      if (data.logo) {
        formData.append('logo', data.logo);
      }

      // Content-Type is auto-set by axios interceptor for FormData
      const response = await apiClient.put<Brand>(
        `${AUTH_CONFIG.BRAND_ENDPOINT}${id}/`,
        formData
      );
      return response.data;
    } else {
      const response = await apiClient.put<Brand>(
        `${AUTH_CONFIG.BRAND_ENDPOINT}${id}/`,
        { company: data.company, name: data.name }
      );
      return response.data;
    }
  }

  /**
   * Partial update brand
   */
  async partialUpdateBrand(
    id: number,
    data: Partial<CreateBrandRequest>
  ): Promise<Brand> {
    const hasFile = data.logo instanceof File;

    if (hasFile) {
      const formData = new FormData();
      if (data.company !== undefined) {
        formData.append('company', String(data.company));
      }
      if (data.name !== undefined) {
        formData.append('name', data.name);
      }
      if (data.logo) {
        formData.append('logo', data.logo);
      }

      // Content-Type is auto-set by axios interceptor for FormData
      const response = await apiClient.patch<Brand>(
        `${AUTH_CONFIG.BRAND_ENDPOINT}${id}/`,
        formData
      );
      return response.data;
    } else {
      // Use JSON for non-file updates
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { logo, ...jsonData } = data;
      const response = await apiClient.patch<Brand>(
        `${AUTH_CONFIG.BRAND_ENDPOINT}${id}/`,
        jsonData
      );
      return response.data;
    }
  }

  /**
   * Delete brand
   */
  async deleteBrand(id: number): Promise<void> {
    await apiClient.delete(`${AUTH_CONFIG.BRAND_ENDPOINT}${id}/`);
  }
}

export const brandService = new BrandService();
