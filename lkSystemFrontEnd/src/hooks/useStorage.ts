import { useState, useEffect, useCallback } from 'react';
import {
  setSecureCookie,
  getSecureCookie,
  removeSecureCookie,
} from '@/utils/cookieStorage';

/**
 * Hook for storing and retrieving data from localStorage (plain text)
 * @param key - Storage key
 * @param initialValue - Default value if none exists
 * @returns [storedValue, setValue, removeValue]
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prevValue: T) => T)) => void, () => void] {
  // State to store our value
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      // Get from local storage by key
      const item = localStorage.getItem(key);

      // Parse stored json or if none return initialValue
      // Handle null, undefined, or invalid JSON properly
      if (item === null || item === 'undefined' || item === undefined) {
        return initialValue;
      }

      try {
        return JSON.parse(item) as T;
      } catch {
        // If JSON parsing fails, return the initialValue
        console.error(
          `Error parsing JSON for key "${key}". Returning initial value.`
        );
        return initialValue;
      }
    } catch (error) {
      // If error accessing localStorage, return initialValue
      console.error(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  // Return a wrapped version of useState's setter function that persists the new value to localStorage
  const setValue = useCallback(
    (value: T | ((prevValue: T) => T)) => {
      try {
        // Save state
        const valueToStore =
          value instanceof Function ? value(storedValue) : value;
        setStoredValue(valueToStore);
        // Save to local storage
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      } catch (error) {
        console.error(`Error setting localStorage key "${key}":`, error);
      }
    },
    [key, storedValue]
  );

  // Function to remove item from localStorage
  const removeValue = useCallback(() => {
    try {
      // Remove from local storage
      window.localStorage.removeItem(key);
      // Reset state to initial value
      setStoredValue(initialValue);
    } catch (error) {
      console.error(`Error removing localStorage key "${key}":`, error);
    }
  }, [key, initialValue]);

  // Listen for changes to this localStorage key in other windows/tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) {
        try {
          // If the key changed in another window, update state
          setStoredValue(JSON.parse(e.newValue) as T);
        } catch (error) {
          console.error(
            `Error parsing localStorage key "${key}" from storage event:`,
            error
          );
        }
      } else if (e.key === key && e.newValue === null) {
        // If the key was removed in another window, reset state
        setStoredValue(initialValue);
      }
    };

    // Add event listener for storage changes
    window.addEventListener('storage', handleStorageChange);

    // Remove event listener on cleanup
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key, initialValue]);

  return [storedValue, setValue, removeValue];
}

/**
 * Hook for storing and retrieving encrypted data from cookies
 * Uses Web Crypto API for strong encryption with cookie storage
 * @param key - Storage key (cookie name)
 * @param initialValue - Default value if none exists
 * @param options - Cookie options (expires, secure, etc.)
 * @returns [storedValue, setValue, removeValue, isLoading, error]
 */
export function useSecureStorage(
  key: string,
  initialValue: string = '',
  options?: { expires?: number }
): [
  string,
  (value: string) => Promise<void>,
  () => void,
  boolean,
  Error | null,
] {
  const [storedValue, setStoredValue] = useState<string>(initialValue);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  // Load initial value from cookie
  useEffect(() => {
    async function loadEncryptedValue() {
      setIsLoading(true);
      setError(null);

      try {
        const cookieValue = await getSecureCookie(key);

        if (cookieValue !== null) {
          setStoredValue(cookieValue);
        } else {
          setStoredValue(initialValue);
        }
      } catch (error) {
        console.error(`Error reading encrypted cookie "${key}":`, error);
        setError(error instanceof Error ? error : new Error(String(error)));
        setStoredValue(initialValue);
      } finally {
        setIsLoading(false);
      }
    }

    void loadEncryptedValue();
  }, [key, initialValue]);

  // Function to save encrypted value to cookie
  const setValue = useCallback(
    async (value: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        // Update state
        setStoredValue(value);

        // Encrypt and save to cookie
        await setSecureCookie(key, value, {
          expires: options?.expires || 7,
          secure: import.meta.env.PROD,
          sameSite: 'strict',
        });
      } catch (error) {
        console.error(`Error setting encrypted cookie "${key}":`, error);
        setError(error instanceof Error ? error : new Error(String(error)));
      } finally {
        setIsLoading(false);
      }
    },
    [key, options]
  );

  // Function to remove cookie
  const removeValue = useCallback(() => {
    try {
      removeSecureCookie(key);
      setStoredValue(initialValue);
    } catch (error) {
      console.error(`Error removing encrypted cookie "${key}":`, error);
      setError(error instanceof Error ? error : new Error(String(error)));
    }
  }, [key, initialValue]);

  return [storedValue, setValue, removeValue, isLoading, error];
}
