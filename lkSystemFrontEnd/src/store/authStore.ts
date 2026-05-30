/**
 * Zustand Auth Store
 * Global authentication state with localStorage for non-sensitive data
 */

import { create } from 'zustand';
import type { AuthState, LoginRequest, User } from '@/types';
import { authService } from '@/services/auth.service';

// Initialize user from localStorage (non-sensitive display data)
function initializeUserFromStorage(): User | null {
  return authService.getStoredUser();
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: initializeUserFromStorage(),
  accessToken: null, // Access token stays in memory in auth service
  isAuthenticated: authService.isAuthenticated(),
  isLoading: false,
  error: null,

  /**
   * Login action
   */
  login: async (credentials: LoginRequest) => {
    set({ isLoading: true, error: null });

    try {
      const response = await authService.login(credentials);

      set({
        user: response.user,
        accessToken: response.access,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Login failed';

      set({
        user: null,
        accessToken: null,
        isAuthenticated: false,
        isLoading: false,
        error: errorMessage,
      });

      throw error;
    }
  },

  /**
   * Logout action
   */
  logout: () => {
    authService.logout();
    set({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  },

  /**
   * Refresh token action
   */
  refreshToken: async () => {
    try {
      const newAccessToken = await authService.refreshToken();
      set({ accessToken: newAccessToken });
    } catch (error) {
      // If refresh fails, logout user
      get().logout();
      throw error;
    }
  },

  /**
   * Switch the active workspace (company and/or brand).
   *
   * The backend validates the target and returns fresh tokens + the updated
   * user. We swap the in-store user and access token. The caller (the sidebar
   * switcher) clears the React Query cache so no previous-workspace data
   * lingers.
   */
  switchWorkspace: async (companyId: number | null, brandId: number | null) => {
    set({ isLoading: true, error: null });
    try {
      const user = await authService.switchWorkspace({
        company_id: companyId,
        brand_id: brandId,
      });
      set({
        user,
        accessToken: authService.getStoredAccessToken(),
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to switch workspace';
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  /**
   * Clear error
   */
  clearError: () => {
    set({ error: null });
  },
}));

// Track initialization state
let authInitialized = false;
let authInitializing: Promise<void> | null = null;

/**
 * Wait for auth to be initialized
 * Call this before making authenticated API requests
 */
export async function waitForAuthInit(): Promise<void> {
  if (authInitialized) return;
  if (authInitializing) return authInitializing;

  authInitializing = authService
    .initializeAuth()
    .then(() => {
      const user = authService.getStoredUser();
      const isAuth = authService.isAuthenticated();

      if (user && isAuth) {
        useAuthStore.setState({
          user,
          isAuthenticated: true,
        });
      }
      authInitialized = true;
    })
    .catch(error => {
      console.error('Failed to initialize auth state:', error);
      authInitialized = true; // Mark as done even on error to prevent infinite waiting
    });

  return authInitializing;
}

// Start initialization immediately
void waitForAuthInit();

export default useAuthStore;
