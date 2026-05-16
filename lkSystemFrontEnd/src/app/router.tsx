import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/layout/Layout';
import HomePage from '@/pages/HomePage';
import DashbordLayout from '@/components/dashboardLayout/pageDashbord';
import LoginPage from '@/pages/login';
import ForgotPasswordPage from '@/pages/ForgotPasswordPage';
import ResetPasswordPage from '@/pages/ResetPasswordPage';
import AcceptInvitationPage from '@/pages/AcceptInvitationPage';
import NotFoundPage from '@/pages/NotFoundPage';
import StatisticsPage from '@/pages/StatisticsPage';
import AddUserPageNew from '@/pages/AddUserPageNew';
import UsersPageNew from '@/pages/UsersPageNew';
import UserDetailsPage from '@/pages/UserDetailsPage';
import EditUserPage from '@/pages/EditUserPage';
import RolesPage from '@/pages/RolesPage';
import ProfilePage from '@/pages/ProfilePage';
import CompaniesPage from '@/pages/CompaniesPage';
import AddCompanyPage from '@/pages/AddCompanyPage';
import BrandsPage from '@/pages/BrandsPage';
import SalesChannelsPage from '@/pages/SalesChannelsPage';
import ProductsPage from '@/pages/ProductsPage';
import InventoryPage from '@/pages/InventoryPage';
import ManufacturingPage from '@/pages/ManufacturingPage';
import CategoriesPage from '@/pages/CategoriesPage';
import PromotionsPage from '@/pages/PromotionsPage';
import OrdersPage from '@/pages/OrdersPage';
import ClientsPage from '@/pages/ClientsPage';
import POSPage from '@/pages/POSPage';
import NotificationsPage from '@/pages/NotificationsPage';
import SettingsPage from '@/pages/SettingsPage';
import ProtectedRoute from '@/components/ProtectedRoute';
import RoleGuard from '@/components/RoleGuard';
import { useAuthStore } from '@/store/authStore';
import { hasPermission, hasRole } from '@/hooks/useAuth';

function DashboardIndexRedirect() {
  const user = useAuthStore(state => state.user);
  const cashierWorkspace =
    hasRole(user, 'Cashier') &&
    !hasRole(user, 'SuperAdmin') &&
    !hasRole(user, 'Admin') &&
    !hasRole(user, 'Manager') &&
    !hasRole(user, 'CEO');

  if (cashierWorkspace && hasPermission(user, 'use_pos')) {
    return <Navigate to="/dashboard/pos" replace />;
  }

  if (!hasPermission(user, 'view_dashboard') && hasPermission(user, 'use_pos')) {
    return <Navigate to="/dashboard/pos" replace />;
  }

  return <StatisticsPage />;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
        </Route>

        {/* Protected Dashboard Routes */}
        <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<DashbordLayout />}>
            <Route index element={<DashboardIndexRedirect />} />
            {/* User Management Routes */}
            <Route
              path="users"
              element={
                <RoleGuard requiredPermission="view_users">
                  <UsersPageNew />
                </RoleGuard>
              }
            />
            <Route
              path="users/add"
              element={
                <RoleGuard requiredPermission="create_users">
                  <AddUserPageNew />
                </RoleGuard>
              }
            />
            <Route
              path="users/:id"
              element={
                <RoleGuard requiredPermission="view_users">
                  <UserDetailsPage />
                </RoleGuard>
              }
            />
            <Route
              path="users/:id/edit"
              element={
                <RoleGuard requiredPermission="edit_users">
                  <EditUserPage />
                </RoleGuard>
              }
            />
            {/* Legacy route redirect */}
            <Route
              path="add-user"
              element={
                <RoleGuard requiredPermission="create_users">
                  <AddUserPageNew />
                </RoleGuard>
              }
            />
            {/* Role Management */}
            <Route
              path="roles"
              element={
                <RoleGuard requiredPermission="view_roles">
                  <RolesPage />
                </RoleGuard>
              }
            />
            {/* Profile */}
            <Route
              path="profile"
              element={
                <RoleGuard requiredPermission="view_dashboard">
                  <ProfilePage />
                </RoleGuard>
              }
            />
            {/* SuperAdmin only routes */}
            <Route
              path="companies"
              element={
                <RoleGuard requiredPermission="view_company">
                  <CompaniesPage />
                </RoleGuard>
              }
            />
            <Route
              path="add-company"
              element={
                <RoleGuard requiredPermission="create_company">
                  <AddCompanyPage />
                </RoleGuard>
              }
            />
            <Route
              path="brands"
              element={
                <RoleGuard requiredPermission="view_brands">
                  <BrandsPage />
                </RoleGuard>
              }
            />
            <Route
              path="sales-channels"
              element={
                <RoleGuard requiredPermission="view_sales_channels">
                  <SalesChannelsPage />
                </RoleGuard>
              }
            />
            {/* Product & Category Management */}
            <Route
              path="products"
              element={
                <RoleGuard requiredPermission="view_products">
                  <ProductsPage />
                </RoleGuard>
              }
            />
            <Route
              path="inventory"
              element={
                <RoleGuard requiredPermission="view_inventory">
                  <InventoryPage />
                </RoleGuard>
              }
            />
            <Route
              path="manufacturing"
              element={
                <RoleGuard requiredRole="SuperAdmin">
                  <ManufacturingPage />
                </RoleGuard>
              }
            />
            <Route
              path="categories"
              element={
                <RoleGuard requiredPermission="view_categories">
                  <CategoriesPage />
                </RoleGuard>
              }
            />
            {/* Promotions Management */}
            <Route
              path="promotions"
              element={
                <RoleGuard requiredPermission="view_promotions">
                  <PromotionsPage />
                </RoleGuard>
              }
            />
            {/* Orders & Clients */}
            <Route
              path="orders"
              element={
                <RoleGuard requiredPermission="view_orders">
                  <OrdersPage />
                </RoleGuard>
              }
            />
            {/* Older sessions may have a /dashboard/orders/:id bookmark from
                when the page briefly opened in a new tab. Order details now
                always render as a popup inside /dashboard/orders, so we send
                stale links back there instead of crashing the SPA. */}
            <Route path="orders/:id" element={<Navigate to="/dashboard/orders" replace />} />
            <Route
              path="clients"
              element={
                <RoleGuard requiredPermission="view_clients">
                  <ClientsPage />
                </RoleGuard>
              }
            />
            <Route
              path="pos"
              element={
                <RoleGuard requiredPermission="use_pos" allowCashierWorkspace>
                  <POSPage />
                </RoleGuard>
              }
            />
            <Route
              path="notifications"
              element={
                <RoleGuard requiredPermission="view_dashboard">
                  <NotificationsPage />
                </RoleGuard>
              }
            />
            {/*
              Settings doubles as the "Account" page — every authenticated
              user (cashier included) can manage their own profile here.
              The backend `/users/me/` endpoint operates strictly on
              request.user and strips elevation fields, so the route only
              needs to be reachable, not permission-gated.
            */}
            <Route
              path="settings"
              element={
                <RoleGuard allowCashierWorkspace>
                  <SettingsPage />
                </RoleGuard>
              }
            />
          </Route>
        </Route>

        {/* Public Routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/accept-invitation" element={<AcceptInvitationPage />} />

        {/* 404 Page - catches all unmatched routes */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
