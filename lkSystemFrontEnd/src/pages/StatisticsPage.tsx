import { Navigate } from 'react-router-dom';

import { BIDashboardPage } from '@/pages/bi/BIDashboardPage';
import { hasPermission } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';

/**
 * Dashboard landing page.
 *
 * The dashboard is the executive BI view — only CEO and Super Admin users
 * have access. Other authenticated users are routed to a sensible default
 * (POS for cashiers, orders otherwise).
 */
export default function StatisticsPage() {
  const user = useAuthStore(state => state.user);

  // CEO holds view_bi_dashboard; the Super Admin bypasses via is_superuser.
  const canViewBI = hasPermission(user, 'view_bi_dashboard');

  if (canViewBI) {
    return <BIDashboardPage />;
  }

  if (hasPermission(user, 'use_pos')) {
    return <Navigate to="/dashboard/pos" replace />;
  }
  if (hasPermission(user, 'view_orders')) {
    return <Navigate to="/dashboard/orders" replace />;
  }
  return <Navigate to="/dashboard/settings" replace />;
}
