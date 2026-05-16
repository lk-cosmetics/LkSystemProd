/**
 * Profile Service
 * Handles user profile management, avatar uploads, and document uploads
 */

import { apiClient } from './axios';
import { AUTH_CONFIG } from '@/utils/constants';
import type {
  UserProfileFull,
  UpdateProfileRequest,
  PaginatedResponse,
} from '@/types';

class ProfileService {
  /**
   * Get all profiles (admin only)
   */
  async getProfiles(): Promise<PaginatedResponse<UserProfileFull>> {
    const response = await apiClient.get<PaginatedResponse<UserProfileFull>>(
      AUTH_CONFIG.PROFILE_ENDPOINT
    );
    return response.data;
  }

  /**
   * Get current user's profile
   */
  async getMyProfile(): Promise<UserProfileFull> {
    const response = await apiClient.get<UserProfileFull>(
      `${AUTH_CONFIG.PROFILE_ENDPOINT}me/`
    );
    return response.data;
  }

  /**
   * Get profile by ID
   */
  async getProfileById(id: number): Promise<UserProfileFull> {
    const response = await apiClient.get<UserProfileFull>(
      `${AUTH_CONFIG.PROFILE_ENDPOINT}${id}/`
    );
    return response.data;
  }

  /**
   * Update profile (partial update)
   */
  async updateProfile(
    id: number,
    data: UpdateProfileRequest
  ): Promise<UserProfileFull> {
    const response = await apiClient.patch<UserProfileFull>(
      `${AUTH_CONFIG.PROFILE_ENDPOINT}${id}/`,
      data
    );
    return response.data;
  }

  /**
   * Update profile with file uploads (multipart/form-data)
   */
  async updateProfileWithFiles(
    id: number,
    data: UpdateProfileRequest,
    files?: {
      avatar?: File;
      cin_front?: File;
      cin_back?: File;
      passport_image?: File;
      diploma_file?: File;
    }
  ): Promise<UserProfileFull> {
    const formData = new FormData();

    // Add text fields
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.append(key, value.toString());
      }
    });

    // Add files
    if (files?.avatar) formData.append('avatar', files.avatar);
    if (files?.cin_front) formData.append('cin_front', files.cin_front);
    if (files?.cin_back) formData.append('cin_back', files.cin_back);
    if (files?.passport_image)
      formData.append('passport_image', files.passport_image);
    if (files?.diploma_file)
      formData.append('diploma_file', files.diploma_file);

    const response = await apiClient.patch<UserProfileFull>(
      `${AUTH_CONFIG.PROFILE_ENDPOINT}${id}/`,
      formData,
      // Content-Type boundary is auto-set by axios interceptor for FormData
    );
    return response.data;
  }

  /**
   * Upload avatar only
   */
  async uploadAvatar(id: number, file: File): Promise<UserProfileFull> {
    const formData = new FormData();
    formData.append('avatar', file);

    const response = await apiClient.patch<UserProfileFull>(
      `${AUTH_CONFIG.PROFILE_ENDPOINT}${id}/`,
      formData,
      // Content-Type boundary is auto-set by axios interceptor for FormData
    );
    return response.data;
  }

  /**
   * Upload CIN documents
   */
  async uploadCIN(
    id: number,
    cinNumber: string,
    frontFile: File,
    backFile?: File
  ): Promise<UserProfileFull> {
    const formData = new FormData();
    formData.append('cin_number', cinNumber);
    formData.append('cin_front', frontFile);
    if (backFile) formData.append('cin_back', backFile);

    const response = await apiClient.patch<UserProfileFull>(
      `${AUTH_CONFIG.PROFILE_ENDPOINT}${id}/`,
      formData,
      // Content-Type boundary is auto-set by axios interceptor for FormData
    );
    return response.data;
  }

  /**
   * Upload passport document
   */
  async uploadPassport(
    id: number,
    passportNumber: string,
    file: File
  ): Promise<UserProfileFull> {
    const formData = new FormData();
    formData.append('passport_number', passportNumber);
    formData.append('passport_image', file);

    const response = await apiClient.patch<UserProfileFull>(
      `${AUTH_CONFIG.PROFILE_ENDPOINT}${id}/`,
      formData,
      // Content-Type boundary is auto-set by axios interceptor for FormData
    );
    return response.data;
  }

  /**
   * Upload diploma document
   */
  async uploadDiploma(
    id: number,
    educationLevel: string,
    diplomaTitle: string,
    file: File
  ): Promise<UserProfileFull> {
    const formData = new FormData();
    formData.append('education_level', educationLevel);
    formData.append('diploma_title', diplomaTitle);
    formData.append('diploma_file', file);

    const response = await apiClient.patch<UserProfileFull>(
      `${AUTH_CONFIG.PROFILE_ENDPOINT}${id}/`,
      formData,
      // Content-Type boundary is auto-set by axios interceptor for FormData
    );
    return response.data;
  }
}

export const profileService = new ProfileService();
