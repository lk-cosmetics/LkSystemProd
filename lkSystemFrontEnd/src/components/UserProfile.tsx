/**
 * Example: User Profile Component
 * Demonstrates auth state usage and role-based rendering
 */

import { useAuthStore } from '@/store/authStore';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import LogoutButton from '@/components/LogoutButton';

export function UserProfile() {
  const { user } = useAuthStore();
  const { hasRole, hasPermission } = useAuth();

  if (!user) {
    return null;
  }

  const isAdmin = hasRole('admin');
  const canManageUsers = hasPermission('write:users');

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>User Profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* User Info */}
        <div>
          <p className="text-sm text-gray-500">Matricule</p>
          <p className="font-medium">{user.matricule}</p>
        </div>

        {user.email && (
          <div>
            <p className="text-sm text-gray-500">Email</p>
            <p className="font-medium">{user.email}</p>
          </div>
        )}

        {user.firstName && user.lastName && (
          <div>
            <p className="text-sm text-gray-500">Name</p>
            <p className="font-medium">
              {user.firstName} {user.lastName}
            </p>
          </div>
        )}

        {/* Roles */}
        <div>
          <p className="text-sm text-gray-500 mb-2">Roles</p>
          <div className="flex flex-wrap gap-2">
            {user.roles.map(role => (
              <Badge key={role} variant="secondary">
                {role}
              </Badge>
            ))}
          </div>
        </div>

        {/* Permissions */}
        <div>
          <p className="text-sm text-gray-500 mb-2">Permissions</p>
          <div className="flex flex-wrap gap-2">
            {user.permissions?.slice(0, 5).map(permission => (
              <Badge key={permission} variant="outline">
                {permission}
              </Badge>
            ))}
            {(user.permissions?.length ?? 0) > 5 && (
              <Badge variant="outline">
                +{(user.permissions?.length ?? 0) - 5} more
              </Badge>
            )}
          </div>
        </div>

        {/* Conditional Rendering Examples */}
        {isAdmin && (
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md">
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
              🔧 Admin Access Granted
            </p>
          </div>
        )}

        {canManageUsers && (
          <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-md">
            <p className="text-sm font-medium text-green-800 dark:text-green-200">
              ✓ Can Manage Users
            </p>
          </div>
        )}

        {/* Logout */}
        <LogoutButton variant="destructive" className="w-full" />
      </CardContent>
    </Card>
  );
}

export default UserProfile;
