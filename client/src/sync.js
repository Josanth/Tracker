import { useEffect, useRef } from 'react';

// Cross-tab notifications: when one tab changes data, other tabs re-fetch.
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('tracker-sync') : null;

export function notifyChange(scope) {
  channel?.postMessage({ scope, at: Date.now() });
}

/**
 * Calls `reload` when another tab reports a change, when this tab regains focus,
 * and on a slow poll so changes made by other users show up too.
 */
export function useLiveReload(reload, { pollMs = 20000 } = {}) {
  const ref = useRef(reload);
  ref.current = reload;
  useEffect(() => {
    const run = () => ref.current();
    const onMessage = () => run();
    const onVisible = () => document.visibilityState === 'visible' && run();
    channel?.addEventListener('message', onMessage);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => document.visibilityState === 'visible' && run(), pollMs);
    return () => {
      channel?.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [pollMs]);
}
