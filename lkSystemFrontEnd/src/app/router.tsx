import { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/layout/Layout';
import DashbordLayout from '@/components/dashboardLayout/pageDashbord';
import ProtectedRoute from '@/components/ProtectedRoute';
import RoleGuard from '@/components/RoleGuard';
import PageLoader from '@/components/PageLoader';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import { useAuthStore } from '@/store/authStore';
import { isPosOnlyUser } from '@/hooks/useAuth';

// Route-level code splitting: each page becomes its own chunk that is
// fetched on demand. This keeps the initial bundle small (the router,
// guards and shared layouts ship eagerly; everything else streams in
// behind the <Suspense> boundary below).
const HomePage = lazyWithRetry(() => import('@/pages/HomePage'));
const LoginPage = lazyWithRetry(() => import('@/pages/login'));
const ForgotPasswordPage = lazyWithRetry(() => import('@/pages/ForgotPasswordPage'));
const ResetPasswordPage = lazyWithRetry(() => import('@/pages/ResetPasswordPage'));
const AcceptInvitationPage = lazyWithRetry(() => import('@/pages/AcceptInvitationPage'));
const NotFoundPage = lazyWithRetry(() => import('@/pages/NotFoundPage'));
const StatisticsPage = lazyWithRetry(() => import('@/pages/StatisticsPage'));
const AddUserPageNew = lazyWithRetry(() => import('@/pages/AddUserPageNew'));
const UsersPageNew = lazyWithRetry(() => import('@/pages/UsersPageNew'));
const UserDetailsPage = lazyWithRetry(() => import('@/pages/UserDetailsPage'));
const EditUserPage = lazyWithRetry(() => import('@/pages/EditUserPage'));
const RolesPage = lazyWithRetry(() => import('@/pages/RolesPage'));
const CompaniesPage = lazyWithRetry(() => import('@/pages/CompaniesPage'));
const AddCompanyPage = lazyWithRetry(() => import('@/pages/AddCompanyPage'));
const BrandsPage = lazyWithRetry(() => import('@/pages/BrandsPage'));
const SalesChannelsPage = lazyWithRetry(() => import('@/pages/SalesChannelsPage'));
const ProductsPage = lazyWithRetry(() => import('@/pages/ProductsPage'));
const InventoryPage = lazyWithRetry(() => import('@/pages/InventoryPage'));
const ManufacturingPage = lazyWithRetry(() => import('@/pages/ManufacturingPage'));
const CategoriesPage = lazyWithRetry(() => import('@/pages/CategoriesPage'));
const PromotionsPage = lazyWithRetry(() => import('@/pages/PromotionsPage'));
const OrdersPage = lazyWithRetry(() => import('@/pages/OrdersPage'));
const MyOrdersPage = lazyWithRetry(() => import('@/pages/MyOrdersPage'));
const InvoicesPage = lazyWithRetry(() => import('@/pages/InvoicesPage'));
const ClientsPage = lazyWithRetry(() => import('@/pages/ClientsPage'));
const POSPage = lazyWithRetry(() => import('@/pages/POSPage'));
const NotificationsPage = lazyWithRetry(() => import('@/pages/NotificationsPage'));
const SettingsPage = lazyWithRetry(() => import('@/pages/SettingsPage'));

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
      <RouteErrorBoundary>
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
            <Route
              path="my-orders"
              element={
                <RoleGuard requiredPermission="view_orders">
                  <MyOrdersPage />
                </RoleGuard>
              }
            />
            <Route
              path="invoices"
              element={
                <RoleGuard requiredPermission="view_invoices">
                  <InvoicesPage />
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
      </RouteErrorBoundary>
    </BrowserRouter>
  );
}
