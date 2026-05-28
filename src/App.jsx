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
import LeadDetailsModal from '@/components/lead/LeadDetailsModal';
import { ImpersonationProvider } from '@/components/shared/ImpersonationContext';

const LazyLogin = lazy(() => import('./pages/Login.jsx'));
const LazyHypReturn = lazy(() => import('./pages/HypReturn.jsx'));

// Opening a lead from any list (LeadManagement, Leads, dashboard
// widgets, global search) used to navigate to /LeadDetails as a full
// page — which unmounted the list and lost the manager's scroll
// position / filter state. We now intercept that route and render
// LeadDetails as a modal overlay on top of whatever list page they
// were already on. The 22 existing navigate('/LeadDetails?id=…')
// callsites are untouched; the trick lives in AuthenticatedApp below.
const LEAD_DETAILS_PATH = '/LeadDetails';

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

  // Modal-as-route, scoped to /LeadManagement only: when a manager
  // clicks a lead from the LeadManagement table we keep that page
  // mounted underneath (preserving scroll, filters, pagination) and
  // overlay LeadDetails as a modal. Lead clicks from anywhere else
  // (Leads page, dashboard widgets, global search, deep links)
  // still navigate to the full-page LeadDetails as before — so this
  // is opt-in per entry surface, not a global hijack.
  //
  // The ref holds the last non-/LeadDetails location across renders
  // so mid-modal re-renders don't reset the background. We only
  // activate modal mode if that prior location was LeadManagement.
  const backgroundLocationRef = React.useRef(null);
  if (location.pathname !== LEAD_DETAILS_PATH) {
    backgroundLocationRef.current = location;
  }
  const isLeadModalRoute =
    location.pathname === LEAD_DETAILS_PATH &&
    backgroundLocationRef.current?.pathname === '/LeadManagement';
  const routedLocation = isLeadModalRoute ? backgroundLocationRef.current : location;

  // Authenticated - render app. ImpersonationProvider wraps BOTH
  // <Routes> and the lead-modal sibling so the modal (which is
  // rendered outside any per-route LayoutWrapper) can still call
  // useImpersonation without throwing. Previously the provider
  // lived inside Layout, which broke the modal's contexts.
  return (
    <ImpersonationProvider>
    <Suspense fallback={<PageLoadingFallback />}>
      <Routes location={routedLocation}>
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
      {isLeadModalRoute && (
        <LeadDetailsModal backgroundLocation={backgroundLocationRef.current} />
      )}
    </Suspense>
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
