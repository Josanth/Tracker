import { useEffect } from 'react';
import { Link } from 'react-router-dom';

export const STATUSES = ['To Do', 'In Progress', 'In Review', 'Done'];
export const PRIORITIES = ['Low', 'Medium', 'High'];

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(sqlite) {
  if (!sqlite) return '';
  // SQLite datetime('now') is UTC without a zone marker.
  return new Date(`${sqlite.replace(' ', 'T')}Z`).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function Field({ label, error, children, hint }) {
  return (
    <label className={`field ${error ? 'has-error' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Alert({ kind = 'error', children, onClose, action }) {
  if (!children) return null;
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div className="alert-body">{children}</div>
      {action}
      {onClose && (
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}

const statusClass = (s) => s.toLowerCase().replace(/\s+/g, '-');
export const StatusBadge = ({ status }) => <span className={`badge status-${statusClass(status)}`}>{status}</span>;
export const PriorityBadge = ({ priority }) => (
  <span className={`badge priority-${priority.toLowerCase()}`} title={`${priority} priority`}>
    {priority === 'High' ? '▲' : priority === 'Low' ? '▼' : '■'} {priority}
  </span>
);
export const OverdueBadge = () => <span className="badge overdue">Overdue</span>;

export function Avatar({ user, size = 24 }) {
  if (!user) return <span className="avatar avatar-empty" style={{ width: size, height: size }} title="Unassigned">?</span>;
  const initials = user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  let hue = 0;
  for (const ch of user.name) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      className="avatar"
      title={user.name}
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${hue} 55% 45%)` }}
    >
      {initials}
    </span>
  );
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const Spinner = () => <div className="spinner" aria-label="Loading" />;

export function ErrorPage({ status, message }) {
  const title = status === 403 ? 'Access denied' : status === 404 ? 'Not found' : 'Something went wrong';
  return (
    <div className="error-page">
      <div className="error-code">{status || '!'}</div>
      <h1>{title}</h1>
      <p>{message}</p>
      <Link className="btn" to="/projects">
        Back to projects
      </Link>
    </div>
  );
}

export function TaskRow({ task, projectId }) {
  return (
    <Link className="task-row" to={`/projects/${projectId ?? task.projectId}/tasks/${task.id}`}>
      <span className="task-key">{task.key}</span>
      <span className="task-title">{task.title}</span>
      <span className="task-row-meta">
        {task.overdue && <OverdueBadge />}
        <PriorityBadge priority={task.priority} />
        <StatusBadge status={task.status} />
        <span className={`due ${task.overdue ? 'is-overdue' : ''}`}>{task.dueDate ? formatDate(task.dueDate) : 'No due date'}</span>
        <Avatar user={task.assignee} />
      </span>
    </Link>
  );
}
