/**
 * RBAC Service — API client for the role-based access control system.
 */

import apiClient from './axios';

const BASE = '/api/v1/rbac';

/* ── Types ──────────────────────────────────────────────────────────── */

export interface AppPermission {
  id: number;
  codename: string;
  name: string;
  category: string;
  description: string;
}

export interface PermissionGroup {
  category: string;
  permissions: AppPermission[];
}

/**
 * A navigable application page in the Page Access manager. ``view_codename`` is
 * the permission that gates the page (sidebar item + route guard); a role
 * "has" the page when it holds that codename. ``codenames`` is the full bundle
 * stripped from a role when the page is turned off, so the backend denies the
 * page's entire API surface — not just its list view.
 */
export interface PageDefinition {
  key: string;
  label: string;
  group: string;
  icon: string;
  description: string;
  view_codename: string;
  codenames: string[];
}

export interface RBACRole {
  id: number;
  name: string;
  description: string;
  scope_type: 'platform' | 'company' | 'brand' | 'channel';
  company: number | null;
  company_name: string | null;
  permissions: string[]; // codenames (detail) or count (list)
  /** Page keys this role may NOT open — navigation only, never a permission. */
  hidden_pages?: string[];
  permissions_count?: number;
  assignments_count?: number;
  /** Operational role (Employee/Cashier) that must be pinned to a sales point. */
  requires_sales_point?: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface RoleCreateRequest {
  name: string;
  description?: string;
  scope_type: 'platform' | 'company' | 'brand' | 'channel';
  company?: number | null;
  /** Super-Admin only: create a global default role (company=null), visible to
   * every company. Ignored for non-platform users (backend forces their company). */
  is_global?: boolean;
  permissions: string[]; // codenames
  /** Page keys this role may NOT open (navigation only). */
  hidden_pages?: string[];
}

export interface UserRoleAssignment {
  id: number;
  user: number;
  role: number;
  role_name: string;
  role_scope_type: string;
  company: number | null;
  brand: number | null;
  sales_channel: number | null;
  scope: string;
  permissions: string[];
  assigned_by: number | null;
  assigned_at: string;
}

export interface AssignRoleRequest {
  user_id: number;
  role_id: number;
  company_id?: number | null;
  brand_id?: number | null;
  sales_channel_id?: number | null;
}

export interface UserPermissionsSummary {
  user_id?: number;
  roles: string[];
  permissions: string[];
  assignments: UserRoleAssignment[];
}

/* ── Service ────────────────────────────────────────────────────────── */

export const rbacService = {
  // ── Permissions ──
  getPermissions: () =>
    apiClient.get<PermissionGroup[]>(`${BASE}/permissions/`).then(r => r.data),

  // ── Pages (page-access catalogue) ──
  getPages: () =>
    apiClient.get<PageDefinition[]>(`${BASE}/pages/`).then(r => r.data),

  // ── Roles ──
  getRoles: (params?: Record<string, unknown>) =>
    apiClient
      .get<{ results: RBACRole[] } | RBACRole[]>(`${BASE}/roles/`, { params })
      .then(r => {
        const data = r.data;
        return Array.isArray(data) ? data : data.results;
      }),

  getRole: (id: number) =>
    apiClient.get<RBACRole>(`${BASE}/roles/${id}/`).then(r => r.data),

  createRole: (data: RoleCreateRequest) =>
    apiClient.post<RBACRole>(`${BASE}/roles/`, data).then(r => r.data),

  updateRole: (id: number, data: Partial<RoleCreateRequest>) =>
    apiClient.put<RBACRole>(`${BASE}/roles/${id}/`, data).then(r => r.data),

  deleteRole: (id: number) =>
    apiClient.delete(`${BASE}/roles/${id}/`).then(r => r.data),

  // ── Assignments ──
  getAssignments: () =>
    apiClient
      .get<UserRoleAssignment[]>(`${BASE}/assignments/`)
      .then(r => r.data),

  getMyAssignments: () =>
    apiClient
      .get<UserPermissionsSummary>(`${BASE}/assignments/my/`)
      .then(r => r.data),

  getUserAssignments: (userId: number) =>
    apiClient
      .get<UserPermissionsSummary>(`${BASE}/assignments/user/${userId}/`)
      .then(r => r.data),

  assignRole: (data: AssignRoleRequest) =>
    apiClient
      .post<UserRoleAssignment>(`${BASE}/assignments/assign/`, data)
      .then(r => r.data),

  revokeRole: (assignmentId: number) =>
    apiClient
      .post(`${BASE}/assignments/revoke/`, {
        assignment_id: assignmentId,
      })
      .then(r => r.data),

  /** Replace a user's role with a single new one (Edit User → Role dropdown).
   * The backend derives the scope from the role + the user's brand/sales-point. */
  setRole: (data: { user_id: number; role_id: number }) =>
    apiClient
      .post<{ detail: string; roles: string[] }>(`${BASE}/assignments/set-role/`, data)
      .then(r => r.data),
};
