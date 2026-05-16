/**
 * CSRF Token Management
 * Fetches and manages Django CSRF tokens
 */

import { API_CONFIG } from './constants';

/**
 * Fetch CSRF token from Django backend
 * Call this on app initialization
 */
export async function fetchCsrfToken(): Promise<void> {
  try {
    // Django view that sets csrftoken cookie
    // You need to create this endpoint in Django or use any safe GET endpoint
    const response = await fetch(`${API_CONFIG.BASE_URL}/api/v1/csrf/`, {
      method: 'GET',
      credentials: 'include', // Important: allows cookies
    });

    if (!response.ok) {
      console.warn('⚠️ Failed to fetch CSRF token:', response.status);
    } else {
      console.log('✅ CSRF token fetched successfully');
    }
  } catch (error) {
    console.error('❌ Error fetching CSRF token:', error);
  }
}

/**
 * Get CSRF token from cookie
 */
export function getCsrfToken(): string | null {
  const name = 'csrftoken';
  const cookieValue = document.cookie
    .split('; ')
    .find(row => row.startsWith(`${name}=`))
    ?.split('=')[1];
  return cookieValue || null;
}
