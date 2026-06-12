/**
 * Authentication Service
 * Uses memory for access tokens and HttpOnly cookies (backend-managed) for refresh tokens
 */

import {
  apiClient,
  setAuthTokenGetter,
  setAuthTokenUpdater,
  setRefreshTokenGetter,
} from './axios';
import type {
  LoginRequest,
  LoginResponse,
  TokenRefreshResponse,
  User,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  ValidateResetTokenRequest,
  ValidateResetTokenResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
} from '@/types';
import { AUTH_CONFIG } from '@/utils/constants';

// In-memory storage for tokens (most secure - cleared on page close)
let accessTokenMemory: string | null = null;
let refreshTokenMemory: string | null = null;

class AuthService {
  /**
   * Login user with matricule and password
   */
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    try {

      const response = await apiClient.post<LoginResponse>(
        AUTH_CONFIG.LOGIN_ENDPOINT,
        credentials,
        {
          withCredentials: true, // Important: allows backend to set HttpOnly cookies
        }
      );


      // Store access token in memory (most secure)
      if (response.data.access) {
        accessTokenMemory = response.data.access;
      }

      // Store refresh token in memory and localStorage (persists across page refreshes)
      if (response.data.refresh) {
        refreshTokenMemory = response.data.refresh;
        localStorage.setItem(
          AUTH_CONFIG.STORAGE_KEY.REFRESH_TOKEN,
          response.data.refresh
        );
      }

      // Store user display data in localStorage (non-sensitive)
      if (response.data.user) {
        // Transform backend user data
        const user = response.data.user;
        const [firstName, ...lastNameParts] = (user.full_name || '').split(' ');
        const lastName = lastNameParts.join(' ');

        // Transform role string to roles array for frontend compatibility.
        // Prefer the backend RBAC role list when it is present.
        const transformedUser = {
          ...user,
          roles: user.roles ?? (user.role ? [user.role] : []),
          firstName: firstName || '',
          lastName: lastName || '',
        };

        // Update the response with transformed user
        response.data.user = transformedUser;

        const userDisplay = {
          id: user.id,
          matricule: user.matricule,
          firstName: firstName || '',
          lastName: lastName || '',
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          roles: user.roles ?? (user.role ? [user.role] : []),
          permissions: user.permissions ?? [],
          is_superuser: user.is_superuser ?? false,
          can_switch_brands: user.can_switch_brands,
          company_id: user.company_id,
          company_name: user.company_name ?? null,
          current_brand_id: user.current_brand_id ?? null,
          allowed_brand_ids: user.allowed_brand_ids,
        };
        localStorage.setItem(
          AUTH_CONFIG.STORAGE_KEY.USER_DISPLAY,
          JSON.stringify(userDisplay)
        );
      }

      return response.data;
    } catch (error) {
      console.error('❌ Login error:', error);

      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as {
          response?: {
            data?: { detail?: string; message?: string };
            status?: number;
          };
          message?: string;
        };

        if (!axiosError.response) {
          throw new Error(
            'Cannot connect to the server. Please check your connection and try again.'
          );
        }

        // A 401 on login always means the matricule/password pair was rejected
        // (SimpleJWT returns the same generic "No active account…" detail for a
        // wrong password, a wrong matricule, or an inactive account). Show one
        // clear message instead of the backend's technical wording — and never
        // reveal which half was wrong.
        if (axiosError.response.status === 401) {
          throw new Error('Incorrect matricule or password. Please try again.');
        }

        throw new Error(
          axiosError.response?.data?.detail ||
            axiosError.response?.data?.message ||
            'Login failed. Please check your credentials and try again.'
        );
      }

      const err = error as Error;
      throw new Error(err.message || 'Network error. Please try again.');
    }
  }

  /**
   * Switch the active workspace (company and/or brand).
   *
   * The backend validates the target, then returns a fresh JWT pair whose
   * claims reflect the new workspace plus the updated user payload. We store
   * the new tokens exactly like login and persist the refreshed user so the
   * change survives a page refresh. The caller is responsible for purging the
   * React Query cache so no stale data from the previous workspace lingers.
   */
  async switchWorkspace(body: {
    company_id?: number | null;
    brand_id?: number | null;
  }): Promise<User> {
    const response = await apiClient.post(
      '/api/v1/auth/switch-workspace/',
      body,
      { withCredentials: true }
    );
    const data = response.data;

    if (data.access) {
      accessTokenMemory = data.access;
    }
    if (data.refresh) {
      refreshTokenMemory = data.refresh;
      localStorage.setItem(
        AUTH_CONFIG.STORAGE_KEY.REFRESH_TOKEN,
        data.refresh
      );
    }

    return this.mapAndStoreUser(data.user);
  }

  /**
   * Map a backend identity payload to the frontend ``User`` shape and persist
   * the non-sensitive display copy (so it survives a page refresh). Shared by
   * the workspace switch and the live identity refresh.
   */
  private mapAndStoreUser(user: User): User {
    const [firstName, ...lastNameParts] = (user.full_name || '').split(' ');
    const lastName = lastNameParts.join(' ');
    const roles = user.roles ?? (user.role ? [user.role] : []);
    const transformedUser: User = {
      ...user,
      roles,
      firstName: firstName || '',
      lastName: lastName || '',
    };
    localStorage.setItem(
      AUTH_CONFIG.STORAGE_KEY.USER_DISPLAY,
      JSON.stringify({
        id: user.id,
        matricule: user.matricule,
        firstName: firstName || '',
        lastName: lastName || '',
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        roles,
        permissions: user.permissions ?? [],
        is_superuser: user.is_superuser ?? false,
        can_switch_brands: user.can_switch_brands,
        company_id: user.company_id,
        company_name: user.company_name ?? null,
        current_brand_id: user.current_brand_id ?? null,
        allowed_brand_ids: user.allowed_brand_ids,
      }),
    );
    return transformedUser;
  }

  /**
   * Fetch the caller's identity with permissions recomputed live on the server
   * and refresh the persisted user. Lets an admin's role/permission change take
   * effect in the UI without a logout/login.
   */
  async refreshIdentity(): Promise<User> {
    const { data } = await apiClient.get<{ user: User }>('/api/v1/auth/me/');
    return this.mapAndStoreUser(data.user);
  }

  /**
   * Logout user and clear stored data
   */
  logout(): void {
    // Clear in-memory tokens
    accessTokenMemory = null;
    refreshTokenMemory = null;

    // Clear localStorage
    localStorage.removeItem(AUTH_CONFIG.STORAGE_KEY.USER_DISPLAY);
    localStorage.removeItem(AUTH_CONFIG.STORAGE_KEY.REFRESH_TOKEN);

    // HttpOnly cookie (refresh_token) will be cleared by backend
    // Call backend logout endpoint to clear the cookie
    apiClient
      .post('/api/v1/auth/logout/', {}, { withCredentials: true })
      .catch((err: unknown) => console.error('Logout error:', err));
  }

  /**
   * Request password reset email
   */
  async forgotPassword(
    data: ForgotPasswordRequest
  ): Promise<ForgotPasswordResponse> {
    try {

      const response = await apiClient.post<ForgotPasswordResponse>(
        AUTH_CONFIG.FORGOT_PASSWORD_ENDPOINT,
        data
      );

      return response.data;
    } catch (error) {
      console.error('❌ Forgot password error:', error);

      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as {
          response?: {
            data?: { detail?: string; message?: string };
            status?: number;
          };
        };

        throw new Error(
          axiosError.response?.data?.detail ||
            axiosError.response?.data?.message ||
            'Failed to send reset email. Please try again.'
        );
      }

      throw new Error('Network error. Please try again.');
    }
  }

  /**
   * Validate password reset token
   */
  async validateResetToken(
    data: ValidateResetTokenRequest
  ): Promise<ValidateResetTokenResponse> {
    try {

      const response = await apiClient.post<ValidateResetTokenResponse>(
        AUTH_CONFIG.VALIDATE_RESET_TOKEN_ENDPOINT,
        data
      );

      return response.data;
    } catch (error) {
      console.error('❌ Token validation error:', error);

      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as {
          response?: {
            data?: { detail?: string; message?: string; valid?: boolean };
            status?: number;
          };
        };

        // Return invalid token response instead of throwing
        return {
          valid: false,
          message:
            axiosError.response?.data?.detail ||
            axiosError.response?.data?.message ||
            'Invalid or expired reset token.',
        };
      }

      return {
        valid: false,
        message: 'Network error. Please try again.',
      };
    }
  }

  /**
   * Reset password with token
   */
  async resetPassword(
    data: ResetPasswordRequest
  ): Promise<ResetPasswordResponse> {
    try {

      const response = await apiClient.post<ResetPasswordResponse>(
        AUTH_CONFIG.RESET_PASSWORD_ENDPOINT,
        data
      );

      return response.data;
    } catch (error) {
      console.error('❌ Reset password error:', error);

      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as {
          response?: {
            data?: {
              detail?: string;
              message?: string;
              error?: string;
              new_password?: string[];
              password?: string[];
            };
            status?: number;
          };
        };

        // Log the full error response for debugging
        console.error('Backend error response:', axiosError.response?.data);

        // Handle different error formats from backend
        const errorData = axiosError.response?.data;
        let errorMessage = 'Failed to reset password. Please try again.';

        if (errorData) {
          if (errorData.detail) {
            errorMessage = errorData.detail;
          } else if (errorData.message) {
            errorMessage = errorData.message;
          } else if (errorData.error) {
            errorMessage = errorData.error;
          } else if (
            errorData.new_password &&
            Array.isArray(errorData.new_password)
          ) {
            errorMessage = errorData.new_password.join(' ');
          } else if (errorData.password && Array.isArray(errorData.password)) {
            errorMessage = errorData.password.join(' ');
          } else if (typeof errorData === 'object') {
            // Try to extract first error from object
            const firstKey = Object.keys(errorData)[0];
            const firstValue = errorData[firstKey as keyof typeof errorData];
            if (Array.isArray(firstValue)) {
              errorMessage = `${firstKey}: ${firstValue.join(' ')}`;
            } else if (typeof firstValue === 'string') {
              errorMessage = firstValue;
            }
          }
        }

        throw new Error(errorMessage);
      }

      throw new Error('Network error. Please try again.');
    }
  }

  /**
   * Refresh access token using HttpOnly refresh token cookie
   */
  async refreshToken(): Promise<string> {
    try {
      // Load refresh token from localStorage if not in memory (e.g. after page refresh)
      if (!refreshTokenMemory) {
        refreshTokenMemory = localStorage.getItem(
          AUTH_CONFIG.STORAGE_KEY.REFRESH_TOKEN
        );
      }

      if (!refreshTokenMemory) {
        throw new Error('No refresh token available');
      }


      // Send refresh token in request body
      const response = await apiClient.post<TokenRefreshResponse>(
        AUTH_CONFIG.REFRESH_ENDPOINT,
        { refresh: refreshTokenMemory }, // Send refresh token in body
        { withCredentials: true }
      );


      // Store new access token in memory
      accessTokenMemory = response.data.access;

      // If backend returns a rotated refresh token, update both memory and localStorage
      if (response.data.refresh) {
        refreshTokenMemory = response.data.refresh;
        localStorage.setItem(
          AUTH_CONFIG.STORAGE_KEY.REFRESH_TOKEN,
          response.data.refresh
        );
      }

      return response.data.access;
    } catch (error) {
      // Clear all auth data on refresh failure
      this.logout();
      throw error;
    }
  }

  /**
   * Get stored user display data (non-sensitive)
   */
  getStoredUser(): User | null {
    try {
      const userStr = localStorage.getItem(
        AUTH_CONFIG.STORAGE_KEY.USER_DISPLAY
      );
      if (!userStr) return null;

      const userData = JSON.parse(userStr) as {
        role?: string;
        roles?: string[];
        permissions?: string[];
      };
      // Transform role string to roles array for consistency
      return {
        ...userData,
        roles: userData.roles ?? (userData.role ? [userData.role] : []),
        permissions: userData.permissions ?? [],
      } as User;
    } catch {
      return null;
    }
  }

  /**
   * Get stored access token from memory
   */
  getStoredAccessToken(): string | null {
    return accessTokenMemory;
  }

  /**
   * Get stored refresh token from memory
   */
  getStoredRefreshToken(): string | null {
    return refreshTokenMemory;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    // Check if we have access token in memory OR user display data
    // If user display exists, we can try to refresh the access token
    const hasAccessToken = !!accessTokenMemory;
    const hasUserData = !!localStorage.getItem(
      AUTH_CONFIG.STORAGE_KEY.USER_DISPLAY
    );
    return hasAccessToken || hasUserData;
  }

  /**
   * Initialize auth state from cookies (on app load)
   */
  async initializeAuth(): Promise<void> {
    try {
      // Check if we have user data (means user was logged in)
      const userData = localStorage.getItem(
        AUTH_CONFIG.STORAGE_KEY.USER_DISPLAY
      );

      if (userData && !accessTokenMemory) {
        // Try to refresh the access token using HttpOnly cookie
        try {
          await this.refreshToken();
        } catch (err) {
          // Only a real auth rejection (refresh token invalid/expired) ends the
          // session. A NETWORK failure (offline / server unreachable) must NOT
          // wipe it — the PWA keeps the cashier logged in for offline cold
          // starts, and a fresh access token is minted on reconnect (or the
          // next online 401). The axios interceptor already lets offline
          // requests reject without redirecting, so nothing breaks meanwhile.
          const status = (err as { response?: { status?: number } })?.response?.status;
          if (status === 401 || status === 403) {
            console.warn('⚠️ Refresh token rejected during init — ending session');
            localStorage.removeItem(AUTH_CONFIG.STORAGE_KEY.USER_DISPLAY);
            accessTokenMemory = null;
            refreshTokenMemory = null;
          } else {
            console.warn(
              '⚠️ Token refresh failed (offline/unreachable) — keeping session for offline use',
            );
          }
        }
      }
    } catch (error) {
      console.error('Failed to initialize auth:', error);
      // Don't call logout here - just clear the data silently
      localStorage.removeItem(AUTH_CONFIG.STORAGE_KEY.USER_DISPLAY);
      accessTokenMemory = null;
      refreshTokenMemory = null;
    }
  }
}

// Export singleton instance
export const authService = new AuthService();

// Set up token getters for axios interceptor
setAuthTokenGetter(() => authService.getStoredAccessToken());
setRefreshTokenGetter(() => authService.getStoredRefreshToken());
setAuthTokenUpdater(({ access, refresh }) => {
  if (access !== undefined) {
    accessTokenMemory = access;
  }

  if (refresh !== undefined) {
    refreshTokenMemory = refresh;
    if (refresh) {
      localStorage.setItem(AUTH_CONFIG.STORAGE_KEY.REFRESH_TOKEN, refresh);
    } else {
      localStorage.removeItem(AUTH_CONFIG.STORAGE_KEY.REFRESH_TOKEN);
    }
  }
});

export default authService;
