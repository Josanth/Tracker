import { STATUSES } from './util.js';

const index = (s) => STATUSES.indexOf(s);

/**
 * BR-04 / BR-05 status rules.
 *  - Forward moves go exactly one step: To Do → In Progress → In Review → Done.
 *  - A task may be sent back exactly one step (e.g. In Review → In Progress after review feedback),
 *    except out of Done.
 *  - Leaving Done ("reopening") is allowed only for the project owner, to any earlier status.
 * Returns null when allowed, or an error message.
 */
export function checkTransition(from, to, { isOwner }) {
  if (!STATUSES.includes(to)) return `Unknown status "${to}"`;
  if (from === to) return null;
  if (from === 'Done') {
    return isOwner ? null : 'Only the project owner can reopen a task that is Done';
  }
  const step = index(to) - index(from);
  if (step === 1 || step === -1) return null;
  if (step > 1) {
    return `A task must move through each status in order; "${from}" can only move to "${STATUSES[index(from) + 1]}"`;
  }
  return `A task can only be moved back one status at a time ("${from}" → "${STATUSES[index(from) - 1]}")`;
}

export function allowedTransitions(from, perms) {
  return STATUSES.filter((s) => s !== from && checkTransition(from, s, perms) === null);
}
