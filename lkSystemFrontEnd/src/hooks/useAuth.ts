/**
 * Role-Based Access Control (RBAC) Utilities
 * Helper functions and hooks for permission-based UI rendering
 */

import { useAuthStore } from '@/store/authStore';
import type { User } from '@/types';

function normalizeRoleName(role: string): string {
  return role.replace(/[\s_]+/g, '').toUpperCase();
}

/**
 * Root access is granted only to Django superusers, signalled by the
 * backend `is_superuser` boolean. Every other capability (including the
 * dynamic "Super Admin" RBAC role) is resolved purely from the
 * `permissions` array the backend sends, so there are no hardcoded role
 * names anywhere in the access logic. A Super Admin's permission array
 * already contains every codename, so permission checks pass naturally.
 */
function hasRootAccess(user: User | null): boolean {
  return user?.is_superuser === true;
}

/**
 * Check if user has a specific role
 */
export function hasRole(user: User | null, role: string): boolean {
  if (!user || !role) return false;

  const targetRole = normalizeRoleName(role);
  const userRoles = [
    ...(user.roles ?? []),
    ...(user.role ? [user.role] : []),
  ].map(normalizeRoleName);

  return userRoles.includes(targetRole);
}

/**
 * Check if user has any of the specified roles
 */
export function hasAnyRole(user: User | null, roles: string[]): boolean {
  return roles.some(role => hasRole(user, role));
}

/**
 * Check if user has all specified roles
 */
export function hasAllRoles(user: User | null, roles: string[]): boolean {
  return roles.every(role => hasRole(user, role));
}

/**
 * Check if user has a specific permission
 */
export function hasPermission(user: User | null, permission: string): boolean {
  if (hasRootAccess(user)) return true;
  return user?.permissions?.includes(permission) ?? false;
}

/**
 * Check if user has any of the specified permissions
 */
export function hasAnyPermission(
  user: User | null,
  permissions: string[]
): boolean {
  return permissions.some(permission => hasPermission(user, permission));
}

/**
 * Check if user has all specified permissions
 */
export function hasAllPermissions(
  user: User | null,
  permissions: string[]
): boolean {
  return permissions.every(permission => hasPermission(user, permission));
}

/**
 * Platform owner (Django superuser). The single global root bypass — used to
 * gate platform-only UI without referencing role names.
 */
export function isPlatformAdmin(user: User | null): boolean {
  return user?.is_superuser === true;
}

/**
 * Whether a page is hidden from the user by per-role page access (Roles → Page
 * Access). This is navigation-only and orthogonal to permissions: a page can be
 * hidden while the user keeps the underlying capability (e.g. a cashier denied
 * the Orders page still has `create_orders` for POS). Superusers see everything.
 */
export function isPageHidden(user: User | null, pageKey?: string): boolean {
  if (!pageKey) return false;
  if (hasRootAccess(user)) return false;
  return user?.hidden_pages?.includes(pageKey) ?? false;
}

/**
 * A pure POS / cashier operator: can use the POS but has no back-office reach.
 * Defined by permissions (not role names) so any custom role with the same
 * shape behaves identically. A cashier has `use_pos` and lacks `view_dashboard`.
 */
export function isPosOnlyUser(user: User | null): boolean {
  return hasPermission(user, 'use_pos') && !hasPermission(user, 'view_dashboard');
}

/**
 * Hook to check user roles
 */
export function useRole(role: string): boolean {
  const user = useAuthStore(state => state.user);
  return hasRole(user, role);
}

/**
 * Hook to check user permissions
 */
export function usePermission(permission: string): boolean {
  const user = useAuthStore(state => state.user);
  return hasPermission(user, permission);
}

/**
 * Hook to get current user
 */
export function useCurrentUser(): User | null {
  return useAuthStore(state => state.user);
}

/**
 * Hook for complex authorization checks
 */
export function useAuth() {
  const user = useAuthStore(state => state.user);
  const isAuthenticated = useAuthStore(state => state.isAuthenticated);

  return {
    user,
    isAuthenticated,
    hasRole: (role: string) => hasRole(user, role),
    hasAnyRole: (roles: string[]) => hasAnyRole(user, roles),
    hasAllRoles: (roles: string[]) => hasAllRoles(user, roles),
    hasPermission: (permission: string) => hasPermission(user, permission),
    hasAnyPermission: (permissions: string[]) =>
      hasAnyPermission(user, permissions),
    hasAllPermissions: (permissions: string[]) =>
      hasAllPermissions(user, permissions),
  };
}

/**
 * Example Usage:
 *
 * // Simple role check
 * const isAdmin = useRole('admin');
 *
 * // Simple permission check
 * const canEdit = usePermission('write:users');
 *
 * // Complex checks
 * const { hasAnyRole, hasPermission } = useAuth();
 * const canManageUsers = hasAnyRole(['admin', 'manager']) && hasPermission('write:users');
 *
 * // Conditional rendering
 * return (
 *   <div>
 *     {isAdmin && <AdminPanel />}
 *     {canEdit && <EditButton />}
 *   </div>
 * );
 */
