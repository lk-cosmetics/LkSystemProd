/**
 * Protected Route Component
 * Prevents unauthenticated users from accessing protected routes
 */

import { useState, useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore, waitForAuthInit } from '@/store/authStore';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  readonly children?: React.ReactNode;
  readonly redirectTo?: string;
}

export function ProtectedRoute({
  children,
  redirectTo = '/login',
}: Readonly<ProtectedRouteProps>) {
  const [isInitialized, setIsInitialized] = useState(false);
  const isAuthenticated = useAuthStore(state => state.isAuthenticated);

  useEffect(() => {
    void waitForAuthInit().then(() => {
      setIsInitialized(true);
    });
  }, []);

  // Show loading while auth is initializing
  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="size-8 animate-spin text-accent-1" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Redirect to login if not authenticated
    return <Navigate to={redirectTo} replace />;
  }

  // Render children or Outlet for nested routes
  return children ? <>{children}</> : <Outlet />;
}

export default ProtectedRoute;
