import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TenantProvider, useTenant } from './context/TenantContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Patients from './pages/Patients';
import CallLogs from './pages/CallLogs';
import ScreeningRecords from './pages/ScreeningRecords';
import KnowledgeGraphs from './pages/KnowledgeGraphs';
import Documents from './pages/Documents';
import TestConversation from './pages/TestConversation';
import Settings from './pages/Settings';
import SuperAdmin from './pages/SuperAdmin';
import ReviewerPortal from './pages/Reviewer/ReviewerPortal';

/** Wraps children in TenantProvider only when the user is a super_admin. */
function ConditionalTenantProvider({ children }: { children: React.ReactNode }) {
  const { isSuperAdmin } = useAuth();
  if (!isSuperAdmin) return <>{children}</>;
  return <TenantProvider>{children}</TenantProvider>;
}

/**
 * Guards the protected area of the app.
 * For super_admin users:
 *   - Shows a spinner while tenants are loading.
 *   - Shows an empty-state message when no tenants are configured.
 * Regular admins pass through without any change.
 */
function ProtectedContent() {
  const { isSuperAdmin, isReviewer } = useAuth();
  const { isLoading, tenants, tenantId } = useTenant();

  if (isSuperAdmin && isLoading) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" height="100vh">
        <CircularProgress />
      </Box>
    );
  }

  if (isSuperAdmin && !isLoading && tenants.length === 0) {
    // Still render the app so super_admin can access /super-admin to create tenants
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout><Outlet /></Layout>}>
            <Route path="*" element={<Navigate to="/super-admin" replace />} />
            <Route path="/super-admin" element={<SuperAdmin />} />
          </Route>
        </Route>
      </Routes>
    );
  }

  return (
    // key={tenantId} forces all pages to remount when the tenant changes,
    // so every page re-fetches its data for the newly selected tenant.
    <Routes key={tenantId}>
      {/* Public route */}
      <Route path="/login" element={<Login />} />

      {/* Reviewer portal — full-page, no Layout wrapper */}
      <Route element={<ProtectedRoute />}>
        <Route path="/reviewer" element={isReviewer ? <ReviewerPortal /> : <Navigate to="/dashboard" replace />} />
      </Route>

      {/* All protected routes share the Layout wrapper */}
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout><Outlet /></Layout>}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/patients" element={<Patients />} />
          <Route path="/call-logs" element={<CallLogs />} />
          <Route path="/screening-records" element={<ScreeningRecords />} />
          <Route path="/knowledge-graphs" element={<KnowledgeGraphs />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/test-conversation" element={<TestConversation />} />
          <Route path="/settings" element={<Settings />} />
          {isSuperAdmin && <Route path="/super-admin" element={<SuperAdmin />} />}
        </Route>
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <ConditionalTenantProvider>
        <Box sx={{ display: 'flex', minHeight: '100vh' }}>
          <ProtectedContent />
        </Box>
      </ConditionalTenantProvider>
    </AuthProvider>
  );
}

export default App;
