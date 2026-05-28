import React, { Suspense, lazy } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import ErrorBoundary from '@/components/shared/ErrorBoundary';
import { ImpersonationProvider } from '@/components/shared/ImpersonationContext';
import { LeadModalProvider } from '@/components/lead/LeadModalContext';

const LazyLogin = lazy(() => import('./pages/Login.jsx'));
const LazyHypReturn = lazy(() => import('./pages/HypReturn.jsx'));

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];

const LazyPages = Object.fromEntries(
  Object.keys(Pages).map((name) => [
    name,
    lazy(() => import(`./pages/${name}.jsx`)),
  ])
);

const MainPage = mainPageKey ? LazyPages[mainPageKey] : () => <></>;

const PageLoadingFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const location = useLocation();

  // Invite/recovery links land on '/' with a hash like '#type=invite&access_token=...'.
  // Send them to /login (keeping the hash) so the set-password flow in Login.jsx can fire.
  if (location.hash && /type=(invite|recovery)/.test(location.hash)) {
    return <Navigate to={`/login${location.hash}`} replace />;
  }

  // While checking auth, show a brief loading text
  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <p className="text-gray-500">בודק הרשאות...</p>
      </div>
    );
  }

  // Not authenticated - redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Authenticated - render app.
  //
  // ImpersonationProvider wraps everything so the lead overlay (rendered
  // by LeadModalProvider, outside any per-route LayoutWrapper) can still
  // call useImpersonation, and so impersonation state is shared between
  // the list underneath and the lead in the overlay.
  //
  // LeadModalProvider owns the "open a lead as a popup" behaviour: list
  // pages call openLead(id) instead of navigating, so the URL never
  // changes, the page never reloads, and the list stays mounted right
  // where it was. See LeadModalContext for details.
  return (
    <ImpersonationProvider>
      <LeadModalProvider>
        <Suspense fallback={<PageLoadingFallback />}>
          <Routes>
            <Route path="/" element={
              <LayoutWrapper currentPageName={mainPageKey}>
                <ErrorBoundary>
                  <MainPage />
                </ErrorBoundary>
              </LayoutWrapper>
            } />
            {Object.entries(LazyPages).map(([path, Page]) => (
              <Route
                key={path}
                path={`/${path}`}
                element={
                  <LayoutWrapper currentPageName={path}>
                    <ErrorBoundary>
                      <Page />
                    </ErrorBoundary>
                  </LayoutWrapper>
                }
              />
            ))}
            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </Suspense>
      </LeadModalProvider>
    </ImpersonationProvider>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <Routes>
            <Route path="/login" element={
              <Suspense fallback={<PageLoadingFallback />}>
                <LazyLogin />
              </Suspense>
            } />
            {/* HypReturn renders inside Hyp's payment iframe; skip the
                authenticated Layout chrome since it'd be useless at 500px. */}
            <Route path="/HypReturn" element={
              <Suspense fallback={null}>
                <LazyHypReturn />
              </Suspense>
            } />
            <Route path="*" element={<AuthenticatedApp />} />
          </Routes>
        </Router>
        <Toaster />
        <SonnerToaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
