import { AppSidebar } from '@/components/app-sidebar';
import { SiteHeader } from '@/components/site-header';
import { Outlet, useLocation } from 'react-router-dom';
import { Suspense, useEffect } from 'react';
import PageLoader from '@/components/PageLoader';
import { useAuthStore } from '@/store/authStore';
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from '@/components/ui/sidebar';

function AutoCloseSidebarOnRouteChange() {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();

  // Close mobile sidebar only when the route changes — not when
  // openMobile itself changes (which would instantly re-close it).
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  return null;
}

/**
 * Keeps the cached permission set in sync with the backend so a role change
 * made by an admin takes effect WITHOUT a logout/login. Refreshes on mount,
 * on every route change, when the tab regains focus, and on a light interval.
 */
function LivePermissionSync() {
  const refreshUser = useAuthStore(s => s.refreshUser);
  const { pathname } = useLocation();

  useEffect(() => {
    void refreshUser();
  }, [pathname, refreshUser]);

  useEffect(() => {
    const onFocus = () => { void refreshUser(); };
    window.addEventListener('focus', onFocus);
    const id = window.setInterval(() => { void refreshUser(); }, 60_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(id);
    };
  }, [refreshUser]);

  return null;
}

export default function Page() {
  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 72)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as React.CSSProperties
      }
    >
      <AutoCloseSidebarOnRouteChange />
      <LivePermissionSync />
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <Suspense fallback={<PageLoader />}>
                <Outlet />
              </Suspense>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
