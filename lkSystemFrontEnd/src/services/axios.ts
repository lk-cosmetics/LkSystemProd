/**
 * Axios Instance with Interceptors
 * Handles automatic token attachment and 401 error handling
 */

import axios, {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import { API_CONFIG, AUTH_CONFIG } from '@/utils/constants';

// Import auth service (will be set after initialization to avoid circular dependency)
let getAccessToken: (() => string | null) | null = null;
let getRefreshToken: (() => string | null) | null = null;
let updateAuthTokens:
  | ((tokens: { access?: string | null; refresh?: string | null }) => void)
  | null = null;

export function setAuthTokenGetter(getter: () => string | null) {
  getAccessToken = getter;
}

export function setRefreshTokenGetter(getter: () => string | null) {
  getRefreshToken = getter;
}

export function setAuthTokenUpdater(
  updater: (tokens: { access?: string | null; refresh?: string | null }) => void
) {
  updateAuthTokens = updater;
}

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
}> = [];

const processQueue = (error: Error | null, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });

  failedQueue = [];
};

// Create axios instance
export const apiClient: AxiosInstance = axios.create({
  baseURL: API_CONFIG.BASE_URL,
  timeout: API_CONFIG.TIMEOUT,
  withCredentials: true, // Important: allows HttpOnly cookies
  headers: {
    'Content-Type': 'application/json',
  },
  xsrfCookieName: 'csrftoken', // Django's default CSRF cookie name
  xsrfHeaderName: 'X-CSRFToken', // Django's expected CSRF header name
});


// Helper function to get CSRF token from cookie
function getCsrfToken(): string | null {
  const name = 'csrftoken';
  const cookieValue = document.cookie
    .split('; ')
    .find(row => row.startsWith(`${name}=`))
    ?.split('=')[1];
  return cookieValue || null;
}

// Request interceptor - Attach access token and CSRF token
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Let the browser set multipart boundary automatically for FormData.
    if (config.data instanceof FormData && config.headers) {
      delete config.headers['Content-Type'];
    }

    // Get access token from auth service
    const accessToken = getAccessToken ? getAccessToken() : null;

    if (accessToken && config.headers) {
      config.headers[AUTH_CONFIG.TOKEN_HEADER] =
        `${AUTH_CONFIG.TOKEN_PREFIX} ${accessToken}`;
    } else if (!accessToken && config.url && !config.url.includes('/auth/')) {
      console.warn('⚠️ No access token available for:', config.url);
    }

    // Add CSRF token for unsafe methods (POST, PUT, PATCH, DELETE)
    if (
      config.method &&
      ['post', 'put', 'patch', 'delete'].includes(
        config.method.toLowerCase()
      ) &&
      config.headers
    ) {
      const csrfToken = getCsrfToken();
      if (csrfToken) {
        config.headers['X-CSRFToken'] = csrfToken;
      }
    }

    return config;
  },
  (error: AxiosError) => {
    throw error;
  }
);

// Response interceptor - Handle 401 errors and refresh token
apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    // If error is not 401 or request has already been retried, reject
    if (error.response?.status !== 401 || originalRequest._retry) {
      throw error;
    }

    // If already refreshing, queue the request
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      })
        .then(token => {
          if (originalRequest.headers) {
            originalRequest.headers[AUTH_CONFIG.TOKEN_HEADER] =
              `${AUTH_CONFIG.TOKEN_PREFIX} ${token}`;
          }
          return apiClient(originalRequest);
        })
        .catch(err => {
          throw err;
        });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      // Get the refresh token (from memory or localStorage fallback)
      const refreshToken =
        (getRefreshToken ? getRefreshToken() : null) ??
        localStorage.getItem('refresh_token');

      if (!refreshToken) {
        throw new Error('No refresh token available');
      }

      // Attempt to refresh the token - send refresh token in body
      const response = await axios.post(
        `${API_CONFIG.BASE_URL}${AUTH_CONFIG.REFRESH_ENDPOINT}`,
        { refresh: refreshToken }, // Send refresh token in body
        { withCredentials: true }
      );

      const { access, refresh } = response.data as {
        access: string;
        refresh?: string;
      };

      updateAuthTokens?.({ access, refresh });

      if (originalRequest.headers) {
        originalRequest.headers[AUTH_CONFIG.TOKEN_HEADER] =
          `${AUTH_CONFIG.TOKEN_PREFIX} ${access}`;
      }

      // Process queued requests
      processQueue(null, access);

      // Retry original request
      return apiClient(originalRequest);
    } catch (refreshError) {
      // Refresh failed - clear auth data and redirect to login
      processQueue(refreshError as Error, null);

      // Clear localStorage
      localStorage.removeItem(AUTH_CONFIG.STORAGE_KEY.USER_DISPLAY);
      localStorage.removeItem(AUTH_CONFIG.STORAGE_KEY.REFRESH_TOKEN);
      updateAuthTokens?.({ access: null, refresh: null });
      // HttpOnly cookie cleared by backend

      // Redirect to login page
      if (globalThis.location.pathname !== '/login') {
        globalThis.location.href = '/login';
      }

      throw refreshError;
    } finally {
      isRefreshing = false;
    }
  }
);

export default apiClient;
