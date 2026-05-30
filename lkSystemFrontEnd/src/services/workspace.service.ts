/**
 * Workspace service
 *
 * Reads the companies/brands the current user may switch into. The actual
 * switch (which re-issues tokens) is performed by `authService.switchWorkspace`
 * so token handling stays in one place.
 */

import { apiClient } from './axios';

export interface WorkspaceBrand {
  id: number;
  name: string;
  is_active_brand: boolean;
}

export interface Workspace {
  id: number;
  name: string;
  abbreviation: string;
  logo: string | null;
  is_active_company: boolean;
  brands: WorkspaceBrand[];
}

export interface WorkspacesResponse {
  active_company_id: number | null;
  active_brand_id: number | null;
  workspaces: Workspace[];
}

class WorkspaceService {
  /** GET /api/v1/auth/workspaces/ — the switcher's data source. */
  async getWorkspaces(): Promise<WorkspacesResponse> {
    const response = await apiClient.get<WorkspacesResponse>(
      '/api/v1/auth/workspaces/',
      { withCredentials: true }
    );
    return response.data;
  }
}

export const workspaceService = new WorkspaceService();
export default workspaceService;
