import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { profileService } from '@/services/profile.service';
import type { UpdateProfileRequest } from '@/types';

// Query Keys
export const profileKeys = {
  all: ['profile'] as const,
  me: () => [...profileKeys.all, 'me'] as const,
  details: () => [...profileKeys.all, 'detail'] as const,
  detail: (id: number) => [...profileKeys.details(), id] as const,
};

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Fetch current user's complete profile (with avatar, bio, etc.)
 * Useful for sidebar and profile pages
 */
export function useMyProfile(enabled = true) {
  return useQuery({
    queryKey: profileKeys.me(),
    queryFn: () => profileService.getMyProfile(),
    enabled: enabled,
    staleTime: 1 * 60 * 1000, // 1 minute
    gcTime: 30 * 60 * 1000, // 30 minutes
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

/**
 * Fetch profile by ID
 */
export function useProfile(id: number | null) {
  return useQuery({
    queryKey: profileKeys.detail(id!),
    queryFn: () => profileService.getProfileById(id!),
    enabled: id != null && id > 0,
  });
}

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Update profile (partial update without files)
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (vars: { id: number; data: UpdateProfileRequest }) =>
      profileService.updateProfile(vars.id, vars.data),
    onSuccess: (data) => {
      // Invalidate and refetch
      queryClient.setQueryData(profileKeys.me(), data);
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
    },
  });
}

/**
 * Update profile with file uploads (avatar, CIN, passport, diploma)
 */
export function useUpdateProfileWithFiles() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (vars: {
      id: number;
      data: UpdateProfileRequest;
      files?: {
        avatar?: File;
        cin_front?: File;
        cin_back?: File;
        passport_image?: File;
        diploma_file?: File;
      };
    }) => profileService.updateProfileWithFiles(vars.id, vars.data, vars.files),
    onSuccess: (data) => {
      // Invalidate and refetch
      queryClient.setQueryData(profileKeys.me(), data);
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
    },
  });
}

/**
 * Upload avatar only (simpler mutation)
 */
export function useUploadAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) =>
      profileService.uploadAvatar(id, file),
    onSuccess: (data) => {
      queryClient.setQueryData(profileKeys.me(), data);
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
    },
  });
}
