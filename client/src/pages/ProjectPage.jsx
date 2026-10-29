import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate, useOutletContext, useParams, useSearchParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { notifyChange, useLiveReload } from '../sync.js';
import { ActivityList } from '../activity.jsx';
import {
  Alert,
  Avatar,
  ErrorPage,
  Field,
  OverdueBadge,
  PRIORITIES,
  PriorityBadge,
  STATUSES,
  Spinner,
  TaskRow,
  formatDate,
} from '../components.jsx';
import CreateTaskModal, { hasTaskDraft } from './CreateTaskModal.jsx';
import { ProjectFields, validateProject } from './ProjectsPage.jsx';

export default function ProjectLayout() {
  const { projectId } = useParams();
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const reload = useCallback(
    () =>
      api(`/projects/${projectId}`)
        .then((d) => {
          setProject(d.project);
          setError(null);
        })
        .catch((e) => setError(e)),
    [projectId]
  );
  useEffect(() => {
    setProject(null);
    reload();
  }, [reload]);
  useLiveReload(reload);

  // Re-open the create form automatically if the page was refreshed while a draft existed.
  useEffect(() => {
    if (project && hasTaskDraft(project.id)) setCreating(true);
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && (error.status === 403 || error.status === 404)) return <ErrorPage status={error.status} message={error.message} />;
  if (!project) return error ? <Alert>{error.message}</Alert> : <Spinner />;

  const p = project.permissions;
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="crumbs">
            <Link to="/projects">Projects</Link> / <span className="project-key">{project.key}</span>
          </div>
          <h1>{project.name}</h1>
          {project.description && <p className="muted">{project.description}</p>}
          <p className="muted small">
            Owner: {project.owner.name} · {formatDate(project.startDate)} → {formatDate(project.endDate)}
            {!p.isMember && ' · You are viewing as administrator (read-only for tasks)'}
          </p>
        </div>
        {p.isMember && (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            + New task
          </button>
        )}
      </div>
      <nav className="tabs">
        <NavLink to="board">Board</NavLink>
        <NavLink to="tasks" end>
          Tasks
        </NavLink>
        <NavLink to="members">Members ({project.members.length})</NavLink>
        <NavLink to="activity">Activity</NavLink>
        {p.canEditProject && <NavLink to="settings">Settings</NavLink>}
      </nav>
      <Outlet context={{ project, setProject, reloadProject: reload }} />
      {creating && (
        <CreateTaskModal
          project={project}
          onClose={() => setCreating(false)}
          onCreated={(task) => {
            setCreating(false);
            navigate(`/projects/${project.id}/tasks/${task.id}`);
          }}
        />
      )}
    </div>
  );
}

export const useProject = () => useOutletContext();

// ---------- Filters shared by Board and List ----------

function useTaskFilters() {
  const [params, setParams] = useSearchParams();
  const filters = {
    q: params.get('q') || '',
    status: params.get('status') || '',
    priority: params.get('priority') || '',
    assignee: params.get('assignee') || '',
  };
  const setFilter = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  return [filters, setFilter, () => setParams({}, { replace: true })];
}

function useTasks(projectId, filters) {
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState('');
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const load = useCallback(
    () =>
      api(`/projects/${projectId}/tasks${qs ? `?${qs}` : ''}`)
        .then((d) => {
          setTasks(d.tasks);
          setError('');
        })
        .catch((e) => setError(e.message)),
    [projectId, qs]
  );
  useEffect(() => {
    load();
  }, [load]);
  useLiveReload(load);
  return { tasks, setTasks, error, setError, reload: load };
}

function FilterBar({ project, filters, setFilter, clear, showStatus = true }) {
  const active = Object.values(filters).some(Boolean);
  return (
    <div className="filter-bar">
      <input
        type="search"
        className="search"
        placeholder="Search by title…"
        value={filters.q}
        onChange={(e) => setFilter('q', e.target.value)}
        aria-label="Search tasks by title"
      />
      {showStatus && (
        <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      )}
      <select value={filters.priority} onChange={(e) => setFilter('priority', e.target.value)} aria-label="Filter by priority">
        <option value="">All priorities</option>
        {PRIORITIES.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <select value={filters.assignee} onChange={(e) => setFilter('assignee', e.target.value)} aria-label="Filter by assignee">
        <option value="">Anyone</option>
        <option value="me">Assigned to me</option>
        <option value="unassigned">Unassigned</option>
        {project.members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      {active && (
        <button className="btn btn-ghost btn-sm" onClick={clear}>
          Clear filters
        </button>
      )}
    </div>
  );
}

// ---------- Board ----------

// Mirrors the server's BR-04/BR-05 rules so the board can highlight legal drop targets.
function canMove(from, to, isOwner) {
  if (from === to) return false;
  if (from === 'Done') return isOwner;
  return Math.abs(STATUSES.indexOf(to) - STATUSES.indexOf(from)) === 1;
}

export function BoardTab() {
  const { project } = useProject();
  const [filters, setFilter, clear] = useTaskFilters();
  const boardFilters = { ...filters, status: '' };
  const { tasks, setTasks, error, setError, reload } = useTasks(project.id, boardFilters);
  const [dragging, setDragging] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const [notice, setNotice] = useState(null);
  const canWork = project.permissions.isMember;
  const isOwner = project.permissions.isOwner;

  const columns = useMemo(() => {
    const by = Object.fromEntries(STATUSES.map((s) => [s, []]));
    for (const t of tasks || []) by[t.status].push(t);
    return by;
  }, [tasks]);

  async function move(task, status) {
    if (task.status === status) return;
    setNotice(null);
    const previous = tasks;
    setTasks(tasks.map((t) => (t.id === task.id ? { ...t, status } : t))); // optimistic
    try {
      const d = await api(`/tasks/${task.id}`, { method: 'PATCH', body: { status, version: task.version } });
      setTasks((ts) => ts.map((t) => (t.id === task.id ? d.task : t)));
      notifyChange(`project:${project.id}`);
    } catch (err) {
      setTasks(previous);
      if (err.code === 'VERSION_CONFLICT') {
        setNotice({ kind: 'warn', text: `${task.key} was changed by someone else, so your move was not applied. The board has been refreshed.` });
        reload();
      } else {
        setNotice({ kind: 'error', text: err.message });
      }
    }
  }

  if (!tasks) return error ? <Alert>{error}</Alert> : <Spinner />;
  return (
    <>
      <FilterBar project={project} filters={filters} setFilter={setFilter} clear={clear} showStatus={false} />
      <Alert>{error}</Alert>
      {notice && (
        <Alert kind={notice.kind} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}
      <p className="muted small board-hint">
        {canWork
          ? 'Drag cards between columns. Tasks move one step at a time (To Do → In Progress → In Review → Done); only the project owner can reopen Done tasks.'
          : 'Read-only: only project members can move tasks.'}
      </p>
      <div className="board">
        {STATUSES.map((status) => {
          const legal = dragging && canMove(dragging.status, status, isOwner);
          const illegal = dragging && !legal && dragging.status !== status;
          return (
            <section
              key={status}
              className={`column ${legal ? 'drop-ok' : ''} ${illegal ? 'drop-no' : ''} ${overCol === status && legal ? 'drop-hover' : ''}`}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = legal ? 'move' : 'none';
                setOverCol(status);
              }}
              onDragLeave={() => setOverCol((c) => (c === status ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                const task = dragging;
                setDragging(null);
                setOverCol(null);
                if (!task || task.status === status) return;
                if (!canMove(task.status, status, isOwner)) {
                  setNotice({
                    kind: 'error',
                    text:
                      task.status === 'Done'
                        ? 'Only the project owner can reopen a task that is Done.'
                        : `Tasks must move one status at a time. ${task.key} is "${task.status}".`,
                  });
                  return;
                }
                move(task, status);
              }}
            >
              <header className="column-header">
                <span className={`dot status-${status.toLowerCase().replace(/\s+/g, '-')}`} />
                {status}
                <span className="count">{columns[status].length}</span>
              </header>
              <div className="column-body">
                {columns[status].map((t) => (
                  <div
                    key={t.id}
                    className={`card ${dragging?.id === t.id ? 'is-dragging' : ''}`}
                    draggable={canWork}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(t.id));
                      setDragging(t);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOverCol(null);
                    }}
                  >
                    <Link className="card-title" to={`/projects/${project.id}/tasks/${t.id}`} draggable={false}>
                      {t.title}
                    </Link>
                    <div className="card-meta">
                      <span className="task-key">{t.key}</span>
                      <PriorityBadge priority={t.priority} />
                      {t.overdue && <OverdueBadge />}
                    </div>
                    <div className="card-foot">
                      <span className={`due small ${t.overdue ? 'is-overdue' : ''}`}>{t.dueDate ? formatDate(t.dueDate) : ''}</span>
                      <span className="card-foot-right">
                        {t.commentCount > 0 && <span className="small muted">💬 {t.commentCount}</span>}
                        <Avatar user={t.assignee} size={22} />
                      </span>
                    </div>
                    {canWork && (
                      <select
                        className="card-move"
                        aria-label={`Move ${t.key}`}
                        value=""
                        onChange={(e) => e.target.value && move(t, e.target.value)}
                      >
                        <option value="">Move…</option>
                        {STATUSES.filter((s) => canMove(t.status, s, isOwner)).map((s) => (
                          <option key={s} value={s}>
                            → {s}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
                {!columns[status].length && <div className="column-empty">No tasks</div>}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

// ---------- List ----------

export function ListTab() {
  const { project } = useProject();
  const [filters, setFilter, clear] = useTaskFilters();
  const { tasks, error } = useTasks(project.id, filters);
  return (
    <>
      <FilterBar project={project} filters={filters} setFilter={setFilter} clear={clear} />
      <Alert>{error}</Alert>
      {!tasks ? (
        <Spinner />
      ) : tasks.length ? (
        <div className="panel">
          <div className="task-list">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} projectId={project.id} />
            ))}
          </div>
        </div>
      ) : (
        <p className="empty">No tasks match these filters.</p>
      )}
    </>
  );
}

// ---------- Members ----------

export function MembersTab() {
  const { project, setProject } = useProject();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [message, setMessage] = useState(null);
  const canManage = project.permissions.canManageMembers;
  const memberIds = new Set(project.members.map((m) => m.id));

  useEffect(() => {
    if (!canManage || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api(`/users?q=${encodeURIComponent(query.trim())}`)
        .then((d) => setResults(d.users.filter((u) => !memberIds.has(u.id))))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query, canManage, project.members]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add(u) {
    setMessage(null);
    try {
      const d = await api(`/projects/${project.id}/members`, { method: 'POST', body: { userId: u.id } });
      setProject(d.project);
      setQuery('');
      setMessage({ kind: 'success', text: `${u.name} added to the project.` });
      notifyChange(`project:${project.id}`);
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
    }
  }

  async function remove(m) {
    if (!window.confirm(`Remove ${m.name} from ${project.name}? Any tasks assigned to them in this project will become unassigned.`)) return;
    setMessage(null);
    try {
      const d = await api(`/projects/${project.id}/members/${m.id}`, { method: 'DELETE' });
      setProject(d.project);
      setMessage({
        kind: d.unassignedTasks.length ? 'warn' : 'success',
        text: d.unassignedTasks.length
          ? `${m.name} removed. These tasks are now unassigned and need a new assignee: ${d.unassignedTasks.join(', ')}.`
          : `${m.name} removed.`,
      });
      notifyChange(`project:${project.id}`);
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
    }
  }

  return (
    <div className="members">
      {message && (
        <Alert kind={message.kind} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}
      {canManage ? (
        <div className="panel">
          <Field label="Add a member" hint="Search registered users by name or email">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type at least 2 characters…" />
          </Field>
          {results.length > 0 && (
            <ul className="user-results">
              {results.map((u) => (
                <li key={u.id}>
                  <span className="inline-user">
                    <Avatar user={u} /> {u.name} <span className="muted small">{u.email}</span>
                  </span>
                  <button className="btn btn-sm" onClick={() => add(u)}>
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim().length >= 2 && !results.length && <p className="muted small">No matching users who aren't already members.</p>}
        </div>
      ) : (
        <p className="muted small">Only the project owner or an administrator can add or remove members.</p>
      )}
      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {project.members.map((m) => (
              <tr key={m.id}>
                <td>
                  <span className="inline-user">
                    <Avatar user={m} /> {m.name} {m.id === user.id && <span className="muted small">(you)</span>}
                  </span>
                </td>
                <td className="muted">{m.email}</td>
                <td>{m.isOwner ? <span className="badge badge-owner">Owner</span> : 'Member'}</td>
                <td className="num">
                  {canManage && !m.isOwner && (
                    <button className="btn btn-danger-ghost btn-sm" onClick={() => remove(m)}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Settings ----------

export function SettingsTab() {
  const { project, setProject } = useProject();
  const toForm = (p) => ({
    name: p.name,
    key: p.key,
    description: p.description,
    startDate: p.startDate || '',
    endDate: p.endDate || '',
  });
  const [form, setForm] = useState(() => toForm(project));
  const [version, setVersion] = useState(project.version);
  const [errors, setErrors] = useState({});
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!project.permissions.canEditProject) return <ErrorPage status={403} message="Only the project owner or an administrator can edit project settings." />;

  async function submit(e) {
    e.preventDefault();
    setSaved(false);
    const v = validateProject(form, false);
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const d = await api(`/projects/${project.id}`, { method: 'PUT', body: { ...form, version } });
      setProject(d.project);
      setVersion(d.project.version);
      setConflict(null);
      setSaved(true);
      notifyChange(`project:${project.id}`);
    } catch (err) {
      if (err.code === 'VERSION_CONFLICT') setConflict(err.data.current);
      else setErrors({ ...err.fields, form: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel settings" onSubmit={submit} noValidate>
      {conflict && (
        <Alert
          kind="warn"
          action={
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setForm(toForm(conflict));
                setVersion(conflict.version);
                setProject(conflict);
                setConflict(null);
              }}
            >
              Load latest
            </button>
          }
        >
          Someone else saved changes to this project while you were editing. Load the latest version (your unsaved edits will be replaced), then re-apply your changes.
        </Alert>
      )}
      {saved && <Alert kind="success">Project saved.</Alert>}
      <Alert>{errors.form}</Alert>
      <ProjectFields form={form} setForm={setForm} errors={errors} creating={false} />
      <div className="modal-actions">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

// ---------- Activity ----------

export function ActivityTab() {
  const { project } = useProject();
  const [items, setItems] = useState(null);
  const load = useCallback(() => api(`/projects/${project.id}/activity`).then((d) => setItems(d.activity)).catch(() => {}), [project.id]);
  useEffect(() => {
    load();
  }, [load]);
  useLiveReload(load);
  if (!items) return <Spinner />;
  return (
    <div className="panel">
      <ActivityList items={items} projectId={project.id} />
    </div>
  );
}
