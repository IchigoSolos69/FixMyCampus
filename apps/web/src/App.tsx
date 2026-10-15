import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AppNotification } from '@fixmycampus/shared';
import { REPORTER_ROLES } from '@fixmycampus/shared';
import { useAuth } from './auth';
import { request, pollOptions } from './api';
import { Icon, Loading } from './components';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage, NotificationsPage, ReportsPage, ProfilePage } from './pages/WorkspacePages';
import { ComplaintDetailPage, ComplaintsPage, NewComplaintPage } from './pages/ComplaintPages';
import { AdminPage } from './pages/AdminPage';

function Protected() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="boot-screen">
        <div className="brand-mark">
          <Icon name="campus" size={32} />
        </div>
        <Loading label="Opening your campus service desk…" />
      </div>
    );
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Shell />;
}
function Shell() {
  const { user, logout } = useAuth();
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  useEffect(() => {
    if (!menu) return;
    document.querySelector<HTMLAnchorElement>('.sidebar nav a')?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(false);
        document.querySelector<HTMLButtonElement>('.menu-toggle')?.focus();
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [menu]);
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => request<{ items: AppNotification[]; unread: number }>('/notifications'),
    ...pollOptions,
  });
  const reporter = REPORTER_ROLES.includes(user!.role);
  const analytics = ['Administrator', 'Campus Incharge'].includes(user!.role);
  const titles: Record<string, string> = {
    '/': 'Overview',
    '/complaints': reporter ? 'My complaints' : 'Complaint queue',
    '/complaints/new': 'Report an issue',
    '/complaints/emergency': 'Urgent report',
    '/notifications': 'Notifications',
    '/reports': 'Reports & insights',
    '/admin': 'Administration',
    '/profile': 'Your account',
  };
  const close = () => setMenu(false);
  return (
    <div className={`app-shell${menu ? ' menu-open' : ''}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {menu && <button className="sidebar-scrim" aria-label="Close navigation" onClick={close} />}
      <aside className="sidebar" aria-label="Primary navigation">
        <Link className="brand" to="/" onClick={close}>
          <span className="brand-mark">
            <Icon name="campus" size={27} />
          </span>
          <span>
            FixMyCampus<small>Campus service desk</small>
          </span>
        </Link>
        <div className="workspace-label">
          <span className="live-dot" />
          Single campus workspace
        </div>
        <nav>
          <NavLink to="/" end onClick={close}>
            <Icon name="dashboard" />
            Overview
          </NavLink>
          {user!.role !== 'Administrator' && (
            <NavLink to="/complaints" end onClick={close}>
              <Icon name="complaints" />
              {reporter ? 'My complaints' : 'Complaint queue'}
            </NavLink>
          )}
          {reporter && (
            <>
              <NavLink to="/complaints/new" onClick={close}>
                <Icon name="plus" />
                Report an issue
              </NavLink>
              <NavLink to="/complaints/emergency" onClick={close}>
                <Icon name="warning" />
                Urgent report
              </NavLink>
            </>
          )}
          <NavLink to="/notifications" onClick={close}>
            <Icon name="bell" />
            Notifications
            {!!notifications.data?.unread && (
              <span className="nav-count">{notifications.data.unread}</span>
            )}
          </NavLink>
          {analytics && (
            <NavLink to="/reports" onClick={close}>
              <Icon name="chart" />
              Reports & insights
            </NavLink>
          )}
          {user!.role === 'Administrator' && (
            <NavLink to="/admin" onClick={close}>
              <Icon name="settings" />
              Administration
            </NavLink>
          )}
        </nav>
        <div className="sidebar-help">
          <Icon name="shield" />
          <strong>A better campus, together.</strong>
          <p>Report an issue. Follow its progress. Help us make things work.</p>
        </div>
        <div className="sidebar-account">
          <Link to="/profile" className="account-link" onClick={close}>
            <span className="avatar">
              {user!.name
                .split(' ')
                .map((x) => x[0])
                .slice(0, 2)
                .join('')}
            </span>
            <span>
              <strong>{user!.name}</strong>
              <small>{user!.role}</small>
            </span>
          </Link>
          <button
            className="icon-button"
            onClick={() => {
              void logout();
            }}
            aria-label="Sign out"
          >
            <Icon name="logout" size={18} />
          </button>
        </div>
      </aside>
      <div className="workspace" inert={menu}>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button menu-toggle"
              aria-label="Open navigation"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <Icon name="menu" />
            </button>
            <span>Campus workspace</span>
            <span className="breadcrumb-divider">/</span>
            <strong>{titles[location.pathname] || 'Complaint details'}</strong>
          </div>
          <div className="topbar-right">
            <span className="sync-label">
              <span className="live-dot" />
              Updates every 5s
            </span>
            <Link
              to="/notifications"
              className="icon-button notification-bell"
              aria-label={`Notifications${notifications.data?.unread ? `, ${notifications.data.unread} unread` : ''}`}
            >
              <Icon name="bell" />
              {!!notifications.data?.unread && <i />}
            </Link>
            <Link to="/profile" className="topbar-avatar avatar" aria-label="Your profile">
              {user!.name.slice(0, 1)}
            </Link>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>FixMyCampus</span>
          <span>Campus services · All times in IST</span>
        </footer>
      </div>
    </div>
  );
}
function RoleGuard({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { user } = useAuth();
  return roles.includes(user!.role) ? children : <Navigate to="/" replace />;
}
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route path="/verify-email" element={<AuthPage mode="verify" />} />
      <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
      <Route path="/reset-password" element={<AuthPage mode="reset" />} />
      <Route element={<Protected />}>
        <Route index element={<DashboardPage />} />
        <Route
          path="complaints"
          element={
            <RoleGuard roles={[...REPORTER_ROLES, 'Campus Incharge', 'Department Officer']}>
              <ComplaintsPage />
            </RoleGuard>
          }
        />
        <Route
          path="complaints/new"
          element={
            <RoleGuard roles={[...REPORTER_ROLES]}>
              <NewComplaintPage />
            </RoleGuard>
          }
        />
        <Route
          path="complaints/emergency"
          element={
            <RoleGuard roles={[...REPORTER_ROLES]}>
              <NewComplaintPage emergency />
            </RoleGuard>
          }
        />
        <Route
          path="complaints/:id"
          element={
            <RoleGuard roles={[...REPORTER_ROLES, 'Campus Incharge', 'Department Officer']}>
              <ComplaintDetailPage />
            </RoleGuard>
          }
        />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route
          path="reports"
          element={
            <RoleGuard roles={['Administrator', 'Campus Incharge']}>
              <ReportsPage />
            </RoleGuard>
          }
        />
        <Route
          path="admin"
          element={
            <RoleGuard roles={['Administrator']}>
              <AdminPage />
            </RoleGuard>
          }
        />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
