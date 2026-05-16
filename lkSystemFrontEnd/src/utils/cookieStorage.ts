/**
 * Secure Cookie Storage Utilities
 * Handles encrypted data storage in cookies
 */

import Cookies from 'js-cookie';

const ENCRYPTION_SECRET =
  import.meta.env.VITE_ENCRYPTION_SECRET || '7f8a9b2c4d6e1f3a5b7c9d0e2f4a6b8c';

/**
 * Encrypt data using Web Crypto API
 */
async function encryptData(text: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const secretKeyData = encoder.encode(ENCRYPTION_SECRET);

    // Generate random salt and IV
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));

    // Import the secret as a raw key
    const importedKey = await globalThis.crypto.subtle.importKey(
      'raw',
      secretKeyData,
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    // Derive an AES-GCM key
    const derivedKey = await globalThis.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      importedKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    // Encrypt the data
    const dataToEncrypt = encoder.encode(text);
    const encryptedData = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      derivedKey,
      dataToEncrypt
    );

    // Combine salt, IV, and encrypted data
    const result = new Uint8Array(
      salt.length + iv.length + encryptedData.byteLength
    );
    result.set(salt, 0);
    result.set(iv, salt.length);
    result.set(new Uint8Array(encryptedData), salt.length + iv.length);

    // Convert to base64
    return btoa(String.fromCharCode(...result));
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt data using Web Crypto API
 */
async function decryptData(encryptedText: string): Promise<string> {
  try {
    // Convert base64 back to array buffer
    const encryptedBuffer = Uint8Array.from(atob(encryptedText), c =>
      c.charCodeAt(0)
    );

    // Extract salt, IV, and encrypted data
    const salt = encryptedBuffer.slice(0, 16);
    const iv = encryptedBuffer.slice(16, 28);
    const encryptedData = encryptedBuffer.slice(28);

    // Convert encryption key to bytes
    const encoder = new TextEncoder();
    const secretKeyData = encoder.encode(ENCRYPTION_SECRET);

    // Import the secret as a raw key
    const importedKey = await globalThis.crypto.subtle.importKey(
      'raw',
      secretKeyData,
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    // Derive the key
    const derivedKey = await globalThis.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      importedKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    // Decrypt the data
    const decryptedData = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      derivedKey,
      encryptedData
    );

    // Convert to string
    const decoder = new TextDecoder();
    return decoder.decode(decryptedData);
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Set encrypted data in cookie
 */
export async function setSecureCookie(
  key: string,
  value: string,
  options?: Cookies.CookieAttributes
): Promise<void> {
  try {
    const encrypted = await encryptData(value);
    Cookies.set(key, encrypted, {
      secure: true, // Only sent over HTTPS (disable for localhost in dev)
      sameSite: 'strict',
      expires: 7, // 7 days
      ...options,
    });
  } catch (error) {
    console.error(`Error setting secure cookie "${key}":`, error);
    throw error;
  }
}

/**
 * Get and decrypt data from cookie
 */
export async function getSecureCookie(key: string): Promise<string | null> {
  try {
    const encrypted = Cookies.get(key);
    if (!encrypted) return null;

    return await decryptData(encrypted);
  } catch (error) {
    console.error(`Error getting secure cookie "${key}":`, error);
    return null;
  }
}

/**
 * Remove cookie
 */
export function removeSecureCookie(key: string): void {
  Cookies.remove(key);
}

/**
 * Set regular (non-encrypted) cookie
 */
export function setCookie(
  key: string,
  value: string,
  options?: Cookies.CookieAttributes
): void {
  Cookies.set(key, value, {
    secure: true,
    sameSite: 'strict',
    expires: 7,
    ...options,
  });
}

/**
 * Get regular cookie
 */
export function getCookie(key: string): string | undefined {
  return Cookies.get(key);
}

/**
 * Remove regular cookie
 */
export function removeCookie(key: string): void {
  Cookies.remove(key);
}
