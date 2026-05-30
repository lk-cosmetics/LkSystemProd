import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/layout/Layout';
import DashbordLayout from '@/components/dashboardLayout/pageDashbord';
import ProtectedRoute from '@/components/ProtectedRoute';
import RoleGuard from '@/components/RoleGuard';
import PageLoader from '@/components/PageLoader';
import { useAuthStore } from '@/store/authStore';
import { isPosOnlyUser } from '@/hooks/useAuth';

// Route-level code splitting: each page becomes its own chunk that is
// fetched on demand. This keeps the initial bundle small (the router,
// guards and shared layouts ship eagerly; everything else streams in
// behind the <Suspense> boundary below).
const HomePage = lazy(() => import('@/pages/HomePage'));
const LoginPage = lazy(() => import('@/pages/login'));
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage'));
const AcceptInvitationPage = lazy(() => import('@/pages/AcceptInvitationPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));
const StatisticsPage = lazy(() => import('@/pages/StatisticsPage'));
const AddUserPageNew = lazy(() => import('@/pages/AddUserPageNew'));
const UsersPageNew = lazy(() => import('@/pages/UsersPageNew'));
const UserDetailsPage = lazy(() => import('@/pages/UserDetailsPage'));
const EditUserPage = lazy(() => import('@/pages/EditUserPage'));
const RolesPage = lazy(() => import('@/pages/RolesPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const CompaniesPage = lazy(() => import('@/pages/CompaniesPage'));
const AddCompanyPage = lazy(() => import('@/pages/AddCompanyPage'));
const BrandsPage = lazy(() => import('@/pages/BrandsPage'));
const SalesChannelsPage = lazy(() => import('@/pages/SalesChannelsPage'));
const ProductsPage = lazy(() => import('@/pages/ProductsPage'));
const InventoryPage = lazy(() => import('@/pages/InventoryPage'));
const ManufacturingPage = lazy(() => import('@/pages/ManufacturingPage'));
const CategoriesPage = lazy(() => import('@/pages/CategoriesPage'));
const PromotionsPage = lazy(() => import('@/pages/PromotionsPage'));
const OrdersPage = lazy(() => import('@/pages/OrdersPage'));
const ClientsPage = lazy(() => import('@/pages/ClientsPage'));
const POSPage = lazy(() => import('@/pages/POSPage'));
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

function DashboardIndexRedirect() {
  const user = useAuthStore(state => state.user);

  if (isPosOnlyUser(user)) {
    return <Navigate to="/dashboard/pos" replace />;
  }

  return <StatisticsPage />;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
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
                <RoleGuard requiredPermission="view_manufacturing">
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
      </Suspense>
    </BrowserRouter>
  );
}
