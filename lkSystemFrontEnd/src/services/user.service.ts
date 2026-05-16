/**
 * User Service
 * Handles user CRUD operations, profile management, and password changes
 */

import { apiClient } from './axios';
import { AUTH_CONFIG } from '@/utils/constants';
import type {
  UserDetails,
  UpdateUserRequest,
  ChangePasswordRequest,
  ChangePasswordResponse,
  UserListItem,
  CreateUserRequest,
  UpdateUserFullRequest,
  AdminChangePasswordRequest,
  PaginatedResponse,
} from '@/types';

export interface UserFilters {
  search?: string;
  is_active?: boolean;
  current_company?: number;
  ordering?: string;
  page?: number;
}

class UserService {
  /**
   * Get paginated list of users with filters
   */
  async getUsers(
    filters?: UserFilters
  ): Promise<PaginatedResponse<UserListItem>> {
    const params = new URLSearchParams();

    if (filters?.search) params.append('search', filters.search);
    if (filters?.is_active !== undefined)
      params.append('is_active', filters.is_active.toString());
    if (filters?.current_company)
      params.append('current_company', filters.current_company.toString());
    if (filters?.ordering) params.append('ordering', filters.ordering);
    if (filters?.page) params.append('page', filters.page.toString());

    const response = await apiClient.get<PaginatedResponse<UserListItem>>(
      `${AUTH_CONFIG.USER_ENDPOINT}?${params.toString()}`
    );
    return response.data;
  }

  /**
   * Get current authenticated user details
   */
  async getCurrentUser(): Promise<UserDetails> {
    const response = await apiClient.get<UserDetails>(
      `${AUTH_CONFIG.USER_ENDPOINT}me/`
    );
    return response.data;
  }

  /**
   * Update current authenticated user (uses /me/ endpoint)
   * This should be used when users update their own profile
   */
  async updateCurrentUser(data: UpdateUserRequest): Promise<UserDetails> {
    const response = await apiClient.patch<UserDetails>(
      `${AUTH_CONFIG.USER_ENDPOINT}me/`,
      data
    );
    return response.data;
  }

  /**
   * Get user by ID
   */
  async getUserById(id: number): Promise<UserDetails> {
    const response = await apiClient.get<UserDetails>(
      `${AUTH_CONFIG.USER_ENDPOINT}${id}/`
    );
    return response.data;
  }

  /**
   * Create a new user
   */
  async createUser(data: CreateUserRequest): Promise<UserDetails> {
    const response = await apiClient.post<UserDetails>(
      AUTH_CONFIG.USER_ENDPOINT,
      data
    );
    return response.data;
  }

  /**
   * Update user (full update for admin)
   */
  async updateUserFull(
    id: number,
    data: UpdateUserFullRequest
  ): Promise<UserDetails> {
    const response = await apiClient.patch<UserDetails>(
      `${AUTH_CONFIG.USER_ENDPOINT}${id}/`,
      data
    );
    return response.data;
  }

  /**
   * Update user profile (partial update)
   */
  async updateUser(id: number, data: UpdateUserRequest): Promise<UserDetails> {
    const response = await apiClient.patch<UserDetails>(
      `${AUTH_CONFIG.USER_ENDPOINT}${id}/`,
      data
    );
    return response.data;
  }

  /**
   * Delete user
   */
  async deleteUser(id: number): Promise<void> {
    await apiClient.delete(`${AUTH_CONFIG.USER_ENDPOINT}${id}/`);
  }

  /**
   * Activate user
   */
  async activateUser(id: number): Promise<UserDetails> {
    const response = await apiClient.patch<UserDetails>(
      `${AUTH_CONFIG.USER_ENDPOINT}${id}/`,
      { is_active: true }
    );
    return response.data;
  }

  /**
   * Deactivate user
   */
  async deactivateUser(id: number): Promise<UserDetails> {
    const response = await apiClient.patch<UserDetails>(
      `${AUTH_CONFIG.USER_ENDPOINT}${id}/`,
      { is_active: false }
    );
    return response.data;
  }

  /**
   * Toggle user active status
   */
  async toggleUserStatus(
    id: number,
    currentStatus: boolean
  ): Promise<UserDetails> {
    return currentStatus ? this.deactivateUser(id) : this.activateUser(id);
  }

  /**
   * Change user password (by user - requires old_password)
   */
  async changePassword(
    id: number,
    data: ChangePasswordRequest
  ): Promise<ChangePasswordResponse> {
    const response = await apiClient.post<ChangePasswordResponse>(
      `${AUTH_CONFIG.USER_ENDPOINT}${id}/change_password/`,
      data
    );
    return response.data;
  }

  /**
   * Admin reset user password (Superadmin/CEO/Manager)
   * Uses the same endpoint - backend determines if old_password is required based on permissions
   */
  async adminResetPassword(
    id: number,
    data: AdminChangePasswordRequest
  ): Promise<ChangePasswordResponse> {
    console.log('📤 Admin Reset Password - Sending request:', {
      endpoint: `${AUTH_CONFIG.USER_ENDPOINT}${id}/change_password/`,
      data,
    });
    const response = await apiClient.post<ChangePasswordResponse>(
      `${AUTH_CONFIG.USER_ENDPOINT}${id}/change_password/`,
      data
    );
    console.log('📥 Admin Reset Password - Response:', response.data);
    return response.data;
  }

  // ── Invitations ──────────────────────────────────────────────────

  async inviteEmployee(data: {
    email: string;
    role_id: number;
    company_id: number;
    brand_ids?: number[];
    sales_channel_id?: number | null;
  }) {
    const response = await apiClient.post(
      `${AUTH_CONFIG.USER_ENDPOINT}invite/`,
      data
    );
    return response.data;
  }

  async getInvitations() {
    const response = await apiClient.get(
      `${AUTH_CONFIG.USER_ENDPOINT}invitations/`
    );
    const data = response.data;
    return Array.isArray(data) ? data : data.results ?? [];
  }

  async cancelInvitation(id: number) {
    const response = await apiClient.post(
      `${AUTH_CONFIG.USER_ENDPOINT}invitations/${id}/cancel/`
    );
    return response.data;
  }
}

export const userService = new UserService();
