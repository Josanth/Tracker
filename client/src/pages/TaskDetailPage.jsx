import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
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
  Spinner,
  StatusBadge,
  formatDate,
  formatDateTime,
  todayISO,
} from '../components.jsx';
import { useProject } from './ProjectPage.jsx';

const EDITABLE = ['title', 'description', 'priority', 'assigneeId', 'dueDate'];
const toForm = (t) => ({
  title: t.title,
  description: t.description,
  priority: t.priority,
  assigneeId: t.assignee ? String(t.assignee.id) : '',
  dueDate: t.dueDate || '',
});

export default function TaskDetailPage() {
  const { taskId } = useParams();
  const { project } = useProject();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [conflict, setConflict] = useState(null); // latest server task after a rejected save
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState('');

  const dirty = !!(data && form && EDITABLE.some((k) => String(form[k] ?? '') !== String(toForm(data.task)[k] ?? '')));

  const dataRef = useRef(data);
  const formRef = useRef(form);
  dataRef.current = data;
  formRef.current = form;

  const load = useCallback(
    async ({ force = false } = {}) => {
      let d;
      try {
        d = await api(`/tasks/${taskId}`);
      } catch (e) {
        // A background refresh hiccup shouldn't wipe the page; access/existence errors should.
        if (!dataRef.current || e.status === 403 || e.status === 404) setLoadError(e);
        return;
      }
      setLoadError(null);
      const prev = dataRef.current;
      const f = formRef.current;
      const isDirty = prev && f && EDITABLE.some((k) => String(f[k] ?? '') !== String(toForm(prev.task)[k] ?? ''));
      if (force || !prev || !isDirty) {
        setData(d);
        setForm(toForm(d.task));
        return;
      }
      // The user has unsaved edits: keep their form and the version they started from (so saving
      // still triggers the conflict check), refresh comments/history, and flag the remote change.
      if (d.task.version !== prev.task.version) setRemoteChanged(true);
      setData({ ...d, task: prev.task });
    },
    [taskId]
  );

  useEffect(() => {
    setData(null);
    setForm(null);
    setConflict(null);
    setRemoteChanged(false);
    load({ force: true });
  }, [load]);
  useLiveReload(() => load());

  if (loadError) return <ErrorPage status={loadError.status} message={loadError.message} />;
  if (!data || !form) return <Spinner />;
  const { task, comments, activity, permissions } = data;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function patch(body, { version = task.version } = {}) {
    setBusy(true);
    setNotice(null);
    try {
      const d = await api(`/tasks/${task.id}`, { method: 'PATCH', body: { ...body, version } });
      setConflict(null);
      setRemoteChanged(false);
      notifyChange(`project:${project.id}`);
      await load({ force: true });
      return d.task;
    } catch (err) {
      if (err.code === 'VERSION_CONFLICT') setConflict(err.data.current);
      else if (err.code === 'INVALID_TRANSITION') setNotice({ kind: 'error', text: err.message });
      else setErrors({ ...err.fields, form: err.message });
      window.scrollTo({ top: 0, behavior: 'smooth' }); // banners render above the form
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save(e, version) {
    e?.preventDefault();
    const v = {};
    if (!form.title.trim()) v.title = 'Task title is required';
    if (form.dueDate && form.dueDate !== task.dueDate && form.dueDate < todayISO()) v.dueDate = 'Due date cannot be in the past';
    setErrors(v);
    if (Object.keys(v).length) return;
    const body = {};
    const original = toForm(task);
    for (const k of EDITABLE) if (String(form[k]) !== String(original[k])) body[k] = form[k] === '' && k !== 'description' ? null : form[k];
    if (!Object.keys(body).length) return;
    const saved = await patch(body, { version });
    if (saved) setNotice({ kind: 'success', text: 'Task saved.' });
  }

  async function changeStatus(status) {
    const saved = await patch({ status });
    if (saved) setNotice({ kind: 'success', text: `Moved to ${status}.` });
  }

  async function remove() {
    if (!window.confirm(`Delete ${task.key} "${task.title}"? This cannot be undone.`)) return;
    try {
      await api(`/tasks/${task.id}`, { method: 'DELETE' });
      notifyChange(`project:${project.id}`);
      navigate(`/projects/${project.id}/board`, { replace: true });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    }
  }

  async function addComment(e) {
    e.preventDefault();
    if (!comment.trim()) {
      setCommentError('Comment cannot be empty');
      return;
    }
    setCommentError('');
    try {
      await api(`/tasks/${task.id}/comments`, { method: 'POST', body: { body: comment } });
      setComment('');
      notifyChange(`project:${project.id}`);
      load({ force: !dirty });
    } catch (err) {
      setCommentError(err.fields?.body || err.message);
    }
  }

  const canEdit = permissions.canEdit;
  return (
    <div className="task-detail">
      <div className="task-detail-main">
        <div className="crumbs">
          <Link to={`/projects/${project.id}/board`}>Board</Link> / <span className="task-key">{task.key}</span>
        </div>

        {conflict && (
          <Alert
            kind="warn"
            action={
              <div className="alert-actions">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setConflict(null);
                    load({ force: true });
                  }}
                >
                  Discard mine & load latest
                </button>
                {dirty && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => save(null, conflict.version)}>
                    Keep mine (overwrite)
                  </button>
                )}
              </div>
            }
          >
            <strong>{task.key} was changed by someone else</strong> since you opened it, so your change was not saved. Latest: “{conflict.title}”, {conflict.status},{' '}
            {conflict.priority} priority, {conflict.assignee ? `assigned to ${conflict.assignee.name}` : 'unassigned'}.
          </Alert>
        )}
        {!conflict && remoteChanged && (
          <Alert
            kind="info"
            action={
              <button type="button" className="btn btn-sm" onClick={() => { setRemoteChanged(false); load({ force: true }); }}>
                Refresh
              </button>
            }
          >
            This task was updated elsewhere while you were editing. Refresh to see the latest (your unsaved edits will be lost), or save to be warned about conflicts.
          </Alert>
        )}
        {notice && (
          <Alert kind={notice.kind} onClose={() => setNotice(null)}>
            {notice.text}
          </Alert>
        )}
        <Alert>{errors.form}</Alert>

        <form onSubmit={save} noValidate className="panel">
          <Field label="Title" error={errors.title}>
            <input className="title-input" value={form.title} onChange={set('title')} disabled={!canEdit} maxLength={200} />
          </Field>
          <Field label="Description">
            <textarea rows={6} value={form.description} onChange={set('description')} disabled={!canEdit} placeholder="Add more detail…" />
          </Field>
          <div className="form-grid form-grid-3">
            <Field label="Priority" error={errors.priority}>
              <select value={form.priority} onChange={set('priority')} disabled={!canEdit}>
                {PRIORITIES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Field>
            <Field label="Assignee" error={errors.assigneeId}>
              <select value={form.assigneeId} onChange={set('assigneeId')} disabled={!canEdit}>
                <option value="">Unassigned</option>
                {project.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Due date" error={errors.dueDate}>
              <input type="date" value={form.dueDate} onChange={set('dueDate')} disabled={!canEdit} />
            </Field>
          </div>
          {canEdit && (
            <div className="modal-actions">
              {dirty && (
                <button type="button" className="btn btn-ghost" onClick={() => setForm(toForm(task))}>
                  Cancel
                </button>
              )}
              <button className="btn btn-primary" disabled={!dirty || busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          )}
        </form>

        <section className="panel">
          <h2>Comments ({comments.length})</h2>
          {comments.length ? (
            <ul className="comments">
              {comments.map((c) => (
                <li key={c.id}>
                  <Avatar user={c.author} size={28} />
                  <div>
                    <div className="comment-head">
                      <strong>{c.author.name}</strong> <span className="muted small">{formatDateTime(c.createdAt)}</span>
                    </div>
                    <div className="comment-body">{c.body}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">No comments yet.</p>
          )}
          {canEdit && (
            <form onSubmit={addComment} noValidate>
              <Field label="Add a comment" error={commentError}>
                <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={5000} />
              </Field>
              <div className="modal-actions">
                <button className="btn">Comment</button>
              </div>
            </form>
          )}
        </section>

        <section className="panel">
          <h2>History</h2>
          <ActivityList items={activity} projectId={project.id} showTask={false} />
        </section>
      </div>

      <aside className="task-detail-side">
        <div className="panel">
          <div className="side-row">
            <span className="muted small">Status</span>
            <span>
              <StatusBadge status={task.status} /> {task.overdue && <OverdueBadge />}
            </span>
          </div>
          {canEdit && (
            <div className="status-actions">
              {permissions.allowedStatuses.length ? (
                permissions.allowedStatuses.map((s) => (
                  <button key={s} className="btn btn-sm" disabled={busy} onClick={() => changeStatus(s)}>
                    {task.status === 'Done' ? 'Reopen → ' : '→ '}
                    {s}
                  </button>
                ))
              ) : (
                <span className="muted small">
                  {task.status === 'Done' ? 'Only the project owner can reopen this task.' : 'No status changes available.'}
                </span>
              )}
            </div>
          )}
          <div className="side-row">
            <span className="muted small">Priority</span>
            <PriorityBadge priority={task.priority} />
          </div>
          <div className="side-row">
            <span className="muted small">Assignee</span>
            <span className="inline-user">
              <Avatar user={task.assignee} /> {task.assignee?.name || 'Unassigned'}
            </span>
          </div>
          <div className="side-row">
            <span className="muted small">Reporter</span>
            <span className="inline-user">
              <Avatar user={task.reporter} /> {task.reporter.name}
            </span>
          </div>
          <div className="side-row">
            <span className="muted small">Due</span>
            <span className={task.overdue ? 'text-danger' : ''}>{formatDate(task.dueDate)}</span>
          </div>
          <div className="side-row">
            <span className="muted small">Created</span>
            <span className="small">{formatDateTime(task.createdAt)}</span>
          </div>
          <div className="side-row">
            <span className="muted small">Updated</span>
            <span className="small">{formatDateTime(task.updatedAt)}</span>
          </div>
        </div>
        {permissions.canDelete && (
          <button className="btn btn-danger-ghost btn-block" onClick={remove}>
            Delete task
          </button>
        )}
      </aside>
    </div>
  );
}
