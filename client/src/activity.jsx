import { Link } from 'react-router-dom';
import { formatDateTime } from './components.jsx';

const FIELD_LABELS = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  status: 'status',
  due_date: 'due date',
  assignee_id: 'assignee',
};

function describeChange(field, { from, to }) {
  const label = FIELD_LABELS[field] || field;
  if (field === 'description') return 'updated the description';
  const show = (v) => (v === null || v === '' ? 'none' : `"${v}"`);
  return `changed ${label} from ${show(from)} to ${show(to)}`;
}

export function describeActivity(a) {
  const d = a.detail || {};
  switch (a.action) {
    case 'project.created':
      return [`created the project ${d.key}`];
    case 'project.updated':
      return ['updated project details'];
    case 'member.added':
      return [`added ${d.memberName} to the project`];
    case 'member.removed':
      return [
        `removed ${d.memberName} from the project` +
          (d.unassignedTasks?.length ? ` (unassigned ${d.unassignedTasks.join(', ')})` : ''),
      ];
    case 'task.created':
      return [`created "${d.title}"`];
    case 'task.deleted':
      return [`deleted task #${d.number} "${d.title}"`];
    case 'task.unassigned':
      return [`unassigned the task because ${d.from} was removed from the project`];
    case 'comment.added':
      return ['added a comment'];
    case 'task.updated':
      return Object.entries(d).map(([field, change]) => describeChange(field, change));
    default:
      return [a.action];
  }
}

export function ActivityList({ items, projectId, showTask = true }) {
  if (!items.length) return <p className="empty">No activity yet.</p>;
  return (
    <ul className="activity">
      {items.map((a) => (
        <li key={a.id}>
          <span className="activity-time">{formatDateTime(a.createdAt)}</span>
          <span>
            <strong>{a.user.name}</strong>{' '}
            {showTask && a.taskKey && (
              <>
                <Link to={`/projects/${projectId}/tasks/${a.taskId}`} className="task-key">
                  {a.taskKey}
                </Link>{' '}
              </>
            )}
            {describeActivity(a).join('; ')}
          </span>
        </li>
      ))}
    </ul>
  );
}
