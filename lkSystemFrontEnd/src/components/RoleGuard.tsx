/**
 * RoleGuard / PermissionGuard Component
 *
 * Protects routes based on user roles OR granular RBAC permissions.
 *
 * Usage:
 *   <RoleGuard requiredRole="SuperAdmin">          — legacy role check
 *   <RoleGuard requiredPermission="manage_products"> — RBAC permission check
 *   <RoleGuard requiredPermissions={['view_orders', 'create_order']}> — any
 */

import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Ban } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import {
  hasRole,
  hasAnyRole,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  isPageHidden,
} from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface RoleGuardProps {
  children: ReactNode;
  /** Legacy: single role name check. */
  requiredRole?: string;
  /** Legacy: multiple role name check. */
  requiredRoles?: string[];
  /** RBAC: single permission codename check. */
  requiredPermission?: string;
  /** RBAC: multiple permission codenames check. */
  requiredPermissions?: string[];
  /** Page-registry key — blocked when hidden for the role (Roles → Page Access). */
  page?: string;
  /** When true, ALL roles/permissions must match (default: any). */
  requireAll?: boolean;
  redirectTo?: string;
  showAccessDenied?: boolean;
}

export default function RoleGuard({
  children,
  requiredRole,
  requiredRoles,
  requiredPermission,
  requiredPermissions,
  page,
  requireAll = false,
  redirectTo = '/dashboard',
  showAccessDenied = true,
}: RoleGuardProps) {
  const { user, isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Page-access denial (navigation control, independent of permissions): the
  // role still holds the capability — it just may not open this page. A cashier
  // denied the Orders page keeps create_orders for POS but can't open Orders.
  if (isPageHidden(user, page)) {
    return showAccessDenied ? (
      <AccessDenied message="This page isn't available for your role." />
    ) : (
      <Navigate to={redirectTo} replace />
    );
  }

  // ── Permission-based check (RBAC — preferred) ──────────────────────
  if (requiredPermission) {
    if (!hasPermission(user, requiredPermission)) {
      return showAccessDenied ? (
        <AccessDenied
          message={
            <>
              You need the <strong>{requiredPermission}</strong> permission.
            </>
          }
        />
      ) : (
        <Navigate to={redirectTo} replace />
      );
    }
  }

  if (requiredPermissions && requiredPermissions.length > 0) {
    const ok = requireAll
      ? hasAllPermissions(user, requiredPermissions)
      : hasAnyPermission(user, requiredPermissions);

    if (!ok) {
      return showAccessDenied ? (
        <AccessDenied
          message={
            <>
              You need {requireAll ? 'all of' : 'one of'}:{' '}
              <strong>{requiredPermissions.join(', ')}</strong>
            </>
          }
        />
      ) : (
        <Navigate to={redirectTo} replace />
      );
    }
  }

  // ── Role-based check (legacy compat) ───────────────────────────────
  if (requiredRole && !hasRole(user, requiredRole)) {
    return showAccessDenied ? (
      <AccessDenied
        message={
          <>
            You need the <strong>{requiredRole}</strong> role.
          </>
        }
      />
    ) : (
      <Navigate to={redirectTo} replace />
    );
  }

  if (requiredRoles && requiredRoles.length > 0) {
    const ok = requireAll
      ? requiredRoles.every(r => hasRole(user, r))
      : hasAnyRole(user, requiredRoles);

    if (!ok) {
      return showAccessDenied ? (
        <AccessDenied
          message={
            <>
              You need {requireAll ? 'all of' : 'one of'}:{' '}
              <strong>{requiredRoles.join(', ')}</strong>
            </>
          }
        />
      ) : (
        <Navigate to={redirectTo} replace />
      );
    }
  }

  return <>{children}</>;
}

/* ── Access Denied card ─────────────────────────────────────────────── */

function AccessDenied({ message }: { message: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="p-8 max-w-md text-center">
        <Ban className="size-16 mx-auto text-red-500 mb-4" />
        <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
        <p className="text-muted-foreground mb-4">{message}</p>
        <Button onClick={() => window.history.back()}>Go Back</Button>
      </Card>
    </div>
  );
}
