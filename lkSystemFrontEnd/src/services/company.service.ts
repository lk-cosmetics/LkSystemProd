/**
 * Company Service
 * Handles all company-related API calls
 */

import { apiClient } from './axios';
import type { Company, CompanyListItem, CreateCompanyRequest, PaginatedResponse } from '@/types';
import { AUTH_CONFIG } from '@/utils/constants';

/**
 * Normalize a list-level company object (only fields from CompanyListSerializer).
 */
function normalizeCompanyListItem(company: Partial<CompanyListItem> & { id: number; name: string }): CompanyListItem {
  return {
    id: company.id,
    name: company.name,
    abbreviation: company.abbreviation ?? '',
    logo: typeof company.logo === 'string' ? company.logo : null,
    city: company.city ?? '',
    is_active: company.is_active ?? true,
    brands_count: company.brands_count ?? 0,
  };
}

/**
 * Normalize a full company object (all fields from CompanyDetailSerializer).
 */
function normalizeCompany(company: Partial<Company> & { id: number; name: string }): Company {
  return {
    ...normalizeCompanyListItem(company),
    legal_name: company.legal_name ?? company.name,
    email: company.email ?? '',
    phone: company.phone ?? '',
    address: company.address ?? '',
    matricule_fiscale: company.matricule_fiscale ?? '',
    registre_commerce: company.registre_commerce ?? '',
    activity_code: company.activity_code ?? '',
    bank_name: company.bank_name ?? '',
    rib: company.rib ?? '',
    created_at: company.created_at ?? '',
    updated_at: company.updated_at ?? '',
  };
}

class CompanyService {
  /**
   * Get all companies (list endpoint returns lightweight data).
   */
  async getAllCompanies(): Promise<CompanyListItem[]> {
    const response = await apiClient.get<PaginatedResponse<CompanyListItem>>(
      AUTH_CONFIG.COMPANY_ENDPOINT
    );
    if (response.data && 'results' in response.data) {
      return response.data.results.map((c) =>
        normalizeCompanyListItem(c as Partial<CompanyListItem> & { id: number; name: string })
      );
    }
    return (response.data as unknown as Array<Partial<CompanyListItem> & { id: number; name: string }>).map(
      (c) => normalizeCompanyListItem(c)
    );
  }

  /**
   * Get active companies only (list endpoint returns lightweight data).
   */
  async getActiveCompanies(): Promise<CompanyListItem[]> {
    const response = await apiClient.get<PaginatedResponse<CompanyListItem>>(
      `${AUTH_CONFIG.COMPANY_ENDPOINT}active/`
    );
    if (response.data && 'results' in response.data) {
      return response.data.results.map((c) =>
        normalizeCompanyListItem(c as Partial<CompanyListItem> & { id: number; name: string })
      );
    }
    return (response.data as unknown as Array<Partial<CompanyListItem> & { id: number; name: string }>).map(
      (c) => normalizeCompanyListItem(c)
    );
  }

  /**
   * Get company by ID
   */
  async getCompanyById(id: number): Promise<Company> {
    const response = await apiClient.get<Company>(
      `${AUTH_CONFIG.COMPANY_ENDPOINT}${id}/`
    );
    return normalizeCompany(response.data as Partial<Company> & { id: number; name: string });
  }

  /**
   * Get company's brands
   */
  async getCompanyBrands(id: number): Promise<unknown[]> {
    const response = await apiClient.get<unknown[]>(
      `${AUTH_CONFIG.COMPANY_ENDPOINT}${id}/brands/`
    );
    return response.data;
  }

  /**
   * Create new company
   */
  async createCompany(data: CreateCompanyRequest): Promise<Company> {
    const formData = new FormData();

    // Append all fields to FormData
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (key === 'logo' && value instanceof File) {
          formData.append(key, value);
        } else if (key === 'logo') {
          // Ignore non-file logo payloads (e.g. existing URL strings).
          return;
        } else if (typeof value === 'boolean') {
          formData.append(key, value.toString());
        } else {
          formData.append(key, String(value));
        }
      }
    });

    const response = await apiClient.post<Company>(
      AUTH_CONFIG.COMPANY_ENDPOINT,
      formData
    );
    return normalizeCompany(response.data as Partial<Company> & { id: number; name: string });
  }

  /**
   * Update company (full update)
   */
  async updateCompany(
    id: number,
    data: CreateCompanyRequest
  ): Promise<Company> {
    const formData = new FormData();

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (key === 'logo' && value instanceof File) {
          formData.append(key, value);
        } else if (key === 'logo') {
          // Ignore non-file logo payloads (e.g. existing URL strings).
          return;
        } else if (typeof value === 'boolean') {
          formData.append(key, value.toString());
        } else {
          formData.append(key, String(value));
        }
      }
    });

    const response = await apiClient.put<Company>(
      `${AUTH_CONFIG.COMPANY_ENDPOINT}${id}/`,
      formData
    );
    return normalizeCompany(response.data as Partial<Company> & { id: number; name: string });
  }

  /**
   * Partial update company
   */
  async partialUpdateCompany(
    id: number,
    data: Partial<CreateCompanyRequest>
  ): Promise<Company> {
    // Check if there's a file to upload
    const hasFile = data.logo instanceof File;

    if (hasFile) {
      // Use FormData for file uploads
      const formData = new FormData();

      Object.entries(data).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (key === 'logo' && value instanceof File) {
            formData.append(key, value);
          } else if (key === 'logo') {
            // Ignore non-file logo payloads (e.g. existing URL strings).
            return;
          } else if (typeof value === 'boolean') {
            formData.append(key, value.toString());
          } else {
            formData.append(key, String(value));
          }
        }
      });

      const response = await apiClient.patch<Company>(
        `${AUTH_CONFIG.COMPANY_ENDPOINT}${id}/`,
        formData
      );
      return normalizeCompany(response.data as Partial<Company> & { id: number; name: string });
    } else {
      // Use JSON for non-file updates
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { logo, ...jsonData } = data;
      const response = await apiClient.patch<Company>(
        `${AUTH_CONFIG.COMPANY_ENDPOINT}${id}/`,
        jsonData
      );
      return normalizeCompany(response.data as Partial<Company> & { id: number; name: string });
    }
  }

  /**
   * Delete company
   */
  async deleteCompany(id: number): Promise<void> {
    await apiClient.delete(`${AUTH_CONFIG.COMPANY_ENDPOINT}${id}/`);
  }
}

export const companyService = new CompanyService();
