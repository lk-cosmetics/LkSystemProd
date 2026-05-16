/**
 * UI Preferences Hooks
 * For storing non-sensitive UI data in localStorage
 */

import { useLocalStorage } from './useStorage';
import { AUTH_CONFIG } from '@/utils/constants';

/**
 * Hook for managing active brand selection
 */
export function useActiveBrand() {
  return useLocalStorage<number | null>(
    AUTH_CONFIG.STORAGE_KEY.ACTIVE_BRAND,
    null
  );
}

/**
 * Hook for managing theme preference
 */
export function useThemePreference() {
  return useLocalStorage<'light' | 'dark' | 'system'>(
    AUTH_CONFIG.STORAGE_KEY.THEME,
    'system'
  );
}

/**
 * Hook for managing language preference
 */
export function useLanguagePreference() {
  return useLocalStorage<'en' | 'fr' | 'ar'>(
    AUTH_CONFIG.STORAGE_KEY.LANGUAGE,
    'en'
  );
}

/**
 * Hook for managing sidebar state
 */
export function useSidebarState() {
  return useLocalStorage<boolean>(
    AUTH_CONFIG.STORAGE_KEY.SIDEBAR_STATE,
    false // false = expanded, true = collapsed
  );
}

/**
 * Example Usage:
 *
 * function MyComponent() {
 *   const [brand, setBrand] = useActiveBrand();
 *   const [theme, setTheme] = useThemePreference();
 *   const [language, setLanguage] = useLanguagePreference();
 *   const [isCollapsed, setCollapsed] = useSidebarState();
 *
 *   return (
 *     <div>
 *       <button onClick={() => setBrand(1)}>Select Brand 1</button>
 *       <button onClick={() => setTheme('dark')}>Dark Mode</button>
 *       <button onClick={() => setLanguage('fr')}>Français</button>
 *       <button onClick={() => setCollapsed(!isCollapsed)}>Toggle Sidebar</button>
 *     </div>
 *   );
 * }
 */
