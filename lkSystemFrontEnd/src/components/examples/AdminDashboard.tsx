/**
 * Example: Protected Admin Dashboard
 * Demonstrates complete auth integration with role-based access
 */

import { useAuth, useCurrentUser } from '@/hooks/useAuth';
import { apiClient } from '@/services/axios';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import LogoutButton from '@/components/LogoutButton';

interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  pendingRequests: number;
}

export function AdminDashboard() {
  const user = useCurrentUser();
  const { hasRole, hasPermission } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check permissions
  const isAdmin = hasRole('admin');
  const canViewStats = hasPermission('read:stats');
  const canManageUsers = hasPermission('write:users');

  // Fetch dashboard data
  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        // Token is automatically attached by axios interceptor
        const response = await apiClient.get<DashboardStats>('/api/v1/dashboard/stats');
        setStats(response.data);
        setError(null);
      } catch (err) {
        setError('Failed to load dashboard statistics');
        console.error('Dashboard error:', err);
      } finally {
        setLoading(false);
      }
    };

    if (canViewStats) {
      fetchStats();
    }
  }, [canViewStats]);

  // Role-based rendering
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              You don't have permission to access this page.
            </p>
            <LogoutButton variant="outline" className="w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back, {user?.firstName || user?.matricule}
          </p>
        </div>
        <LogoutButton />
      </div>

      {/* Stats Cards */}
      {canViewStats && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Total Users</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-12 bg-gray-200 animate-pulse rounded" />
              ) : (
                <p className="text-3xl font-bold">{stats?.totalUsers || 0}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Active Users</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-12 bg-gray-200 animate-pulse rounded" />
              ) : (
                <p className="text-3xl font-bold">{stats?.activeUsers || 0}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pending Requests</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-12 bg-gray-200 animate-pulse rounded" />
              ) : (
                <p className="text-3xl font-bold">{stats?.pendingRequests || 0}</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <Card className="border-red-200 bg-red-50 dark:bg-red-900/20">
          <CardContent className="pt-6">
            <p className="text-red-800 dark:text-red-200">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Action Buttons */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-4">
          {canManageUsers && (
            <>
              <Button>Add New User</Button>
              <Button variant="outline">View All Users</Button>
            </>
          )}
          <Button variant="outline">View Reports</Button>
        </CardContent>
      </Card>

      {/* User Info */}
      <Card>
        <CardHeader>
          <CardTitle>Your Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div>
            <span className="text-sm text-muted-foreground">Matricule: </span>
            <span className="font-medium">{user?.matricule}</span>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Roles: </span>
            <span className="font-medium">{user?.roles.join(', ')}</span>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Permissions: </span>
            <span className="font-medium">{user?.permissions?.length ?? 0} total</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default AdminDashboard;
