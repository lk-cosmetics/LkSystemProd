/**
 * Backend Connection Test Utility
 * Use this to verify backend connectivity
 */

import { API_CONFIG } from '@/utils/constants';

export async function testBackendConnection(): Promise<{
  success: boolean;
  message: string;
  url: string;
}> {
  try {

    const response = await fetch(API_CONFIG.BASE_URL, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return {
      success: true,
      message: `Backend is reachable (Status: ${response.status})`,
      url: API_CONFIG.BASE_URL,
    };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      message: `Cannot connect to backend: ${err.message}`,
      url: API_CONFIG.BASE_URL,
    };
  }
}

// Auto-test on module load in development
if (import.meta.env.DEV) {
  const result = await testBackendConnection();
  if (result.success) {
  } else {
    console.error('❌', result.message);
    console.error('💡 Make sure your backend is running on:', result.url);
  }
}
