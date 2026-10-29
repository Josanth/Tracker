import { Navigate, NavLink, Outlet, Route, Routes, useLocation, Link } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { Avatar, ErrorPage, Spinner } from './components.jsx';
import { LoginPage, RegisterPage, ForgotPasswordPage, ResetPasswordPage } from './pages/AuthPages.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ProjectsPage from './pages/ProjectsPage.jsx';
import ProjectLayout, { BoardTab, ListTab, MembersTab, SettingsTab, ActivityTab } from './pages/ProjectPage.jsx';
import TaskDetailPage from './pages/TaskDetailPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="center-page"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Shell />;
}

function GuestOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/" replace /> : children;
}

function Shell() {
  const { user, logout } = useAuth();
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">◆</span> Tracker
        </Link>
        <nav className="topnav">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/projects">Projects</NavLink>
        </nav>
        <div className="topbar-user">
          {user.role === 'admin' && <span className="badge badge-admin">Admin</span>}
          <NavLink to="/profile" className="user-link">
            <Avatar user={user} size={28} />
            <span className="hide-sm">{user.name}</span>
          </NavLink>
          <button className="btn btn-ghost btn-sm" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
      <Route path="/forgot-password" element={<GuestOnly><ForgotPasswordPage /></GuestOnly>} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<RequireAuth />}>
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<ProjectLayout />}>
          <Route index element={<Navigate to="board" replace />} />
          <Route path="board" element={<BoardTab />} />
          <Route path="tasks" element={<ListTab />} />
          <Route path="tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="members" element={<MembersTab />} />
          <Route path="settings" element={<SettingsTab />} />
          <Route path="activity" element={<ActivityTab />} />
        </Route>
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<ErrorPage status={404} message="That page doesn't exist." />} />
      </Route>
    </Routes>
  );
}
