import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useLiveReload } from '../sync.js';
import { Alert, Avatar, Spinner, STATUSES, TaskRow, formatDate } from '../components.jsx';

function TaskPanel({ title, tasks, empty, tone }) {
  return (
    <section className={`panel ${tone ? `panel-${tone}` : ''}`}>
      <div className="panel-header">
        <h2>{title}</h2>
        <span className="count">{tasks.length}</span>
      </div>
      {tasks.length ? (
        <div className="task-list">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </div>
      ) : (
        <p className="empty">{empty}</p>
      )}
    </section>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api('/dashboard')
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  useLiveReload(load);

  if (!data) return error ? <Alert>{error}</Alert> : <Spinner />;
  const { personal, management } = data;
  const totalTasks = management ? STATUSES.reduce((n, s) => n + management.tasksByStatus[s], 0) : 0;
  const maxPerMember = management ? Math.max(1, ...management.tasksPerMember.map((m) => m.total)) : 1;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Hi, {user.name.split(' ')[0]}</h1>
          <p className="muted">
            Today is {formatDate(data.today)} · week ends {formatDate(data.weekEnd)}
          </p>
        </div>
      </div>
      <Alert>{error}</Alert>

      <div className="grid-3">
        <TaskPanel title="Assigned to me" tasks={personal.assignedToMe} empty="Nothing open is assigned to you." />
        <TaskPanel title="Due this week" tasks={personal.dueThisWeek} empty="Nothing due this week." tone="warn" />
        <TaskPanel title="Overdue" tasks={personal.overdue} empty="No overdue tasks. Nice." tone="danger" />
      </div>

      {management && (
        <>
          <h2 className="section-title">
            {management.scope === 'all' ? 'Administration overview' : 'Projects you own'}
          </h2>
          <div className="stats">
            <Stat label={management.scope === 'all' ? 'Total projects' : 'Projects owned'} value={management.totalProjects} />
            <Stat label={management.scope === 'all' ? 'Total users' : 'People on your projects'} value={management.totalUsers} />
            <Stat label="Total tasks" value={totalTasks} />
            <Stat label="Overdue" value={management.overdue.length} tone={management.overdue.length ? 'danger' : ''} />
            <Stat label="Open & unassigned" value={management.unassignedOpen} tone={management.unassignedOpen ? 'warn' : ''} />
          </div>
          <div className="grid-2">
            <section className="panel">
              <div className="panel-header">
                <h2>Tasks by status</h2>
              </div>
              <div className="status-bars">
                {STATUSES.map((s) => (
                  <div className="bar-row" key={s}>
                    <span className="bar-label">{s}</span>
                    <div className="bar-track">
                      <div
                        className={`bar-fill status-${s.toLowerCase().replace(/\s+/g, '-')}`}
                        style={{ width: `${totalTasks ? (management.tasksByStatus[s] / totalTasks) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="bar-value">{management.tasksByStatus[s]}</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="panel">
              <div className="panel-header">
                <h2>Tasks per team member</h2>
              </div>
              {management.tasksPerMember.length ? (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th className="num">Open</th>
                      <th className="num">Overdue</th>
                      <th className="num">Total</th>
                      <th aria-hidden="true" />
                    </tr>
                  </thead>
                  <tbody>
                    {management.tasksPerMember.map((m) => (
                      <tr key={m.user.id}>
                        <td>
                          <span className="inline-user">
                            <Avatar user={m.user} size={22} /> {m.user.name}
                          </span>
                        </td>
                        <td className="num">{m.open}</td>
                        <td className={`num ${m.overdue ? 'text-danger' : ''}`}>{m.overdue}</td>
                        <td className="num">{m.total}</td>
                        <td className="bar-cell">
                          <div className="mini-bar" style={{ width: `${(m.total / maxPerMember) * 100}%` }} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="empty">No assigned tasks yet.</p>
              )}
            </section>
          </div>
          <TaskPanel title="Overdue across projects" tasks={management.overdue} empty="No overdue tasks." tone="danger" />
        </>
      )}
    </div>
  );
}
