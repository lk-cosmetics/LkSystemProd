/**
 * Application constants
 */

// API Configuration
export const API_CONFIG = {
  BASE_URL:
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
    '', // Empty string = use relative URLs (http://localhost/api/...) in Docker
  // 30s: list/summary endpoints can legitimately take a while when gunicorn
  // workers are busy with outbound WooCommerce/delivery calls; 10s produced
  // spurious "timeout of 10000ms exceeded" failures on the orders dashboard.
  TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
} as const;

// Auth Configuration
export const AUTH_CONFIG = {
  LOGIN_ENDPOINT: '/api/v1/auth/login/',
  REFRESH_ENDPOINT: '/api/v1/auth/refresh/',
  LOGOUT_ENDPOINT: '/api/v1/auth/logout/',
  FORGOT_PASSWORD_ENDPOINT: '/api/v1/auth/forgot-password/',
  VALIDATE_RESET_TOKEN_ENDPOINT: '/api/v1/auth/validate-reset-token/',
  RESET_PASSWORD_ENDPOINT: '/api/v1/auth/reset-password/',
  COMPANY_ENDPOINT: '/api/v1/company/',
  BRAND_ENDPOINT: '/api/v1/brands/',
  SALES_CHANNEL_ENDPOINT: '/api/v1/sales-channels/',
  USER_ENDPOINT: '/api/v1/users/',
  PROFILE_ENDPOINT: '/api/v1/users/profiles/',
  STORAGE_KEY: {
    // HttpOnly cookies (managed by backend)
    REFRESH_TOKEN: 'refresh_token', // Backend sets this as HttpOnly cookie
    // LocalStorage (non-sensitive UI data)
    USER_DISPLAY: 'user_display', // Name, avatar for navbar
    ACTIVE_BRAND: 'active_brand', // Selected brand ID
    THEME: 'theme_preference', // Dark/light mode
    LANGUAGE: 'language', // en, fr, ar
    SIDEBAR_STATE: 'sidebar_state', // Collapsed/expanded
  },
  TOKEN_HEADER: 'Authorization',
  TOKEN_PREFIX: 'Bearer',
} as const;

// Toast Configuration
export const TOAST_CONFIG = {
  DEFAULT_DURATION: 5000,
  SUCCESS_DURATION: 3000,
  ERROR_DURATION: 7000,
  MAX_TOASTS: 5,
} as const;

// Theme Configuration
export const THEME_CONFIG = {
  STORAGE_KEY: 'theme-preference',
  DEFAULT_THEME: 'system',
} as const;

// Form Configuration
export const FORM_CONFIG = {
  DEBOUNCE_DELAY: 300,
  VALIDATION_DELAY: 500,
} as const;

// Application metadata
export const APP_CONFIG = {
  NAME: 'React Template',
  DESCRIPTION: 'Modern React TypeScript template',
  VERSION: '1.0.0',
  AUTHOR: 'Yousif Abozid',
  REPOSITORY: 'https://github.com/YousifAbozid/template-react-ts',
} as const;

// Breakpoints (should match Tailwind CSS)
export const BREAKPOINTS = {
  SM: 640,
  MD: 768,
  LG: 1024,
  XL: 1280,
  '2XL': 1536,
} as const;
