/**
 * lib/useLiveUpdates.ts
 *
 * React-hook port of frontend/events.js `connectLiveUpdates`. Same
 * design notes as the original apply:
 *   - One EventSource per mount; browsers auto-reconnect on drop.
 *   - Handlers are looked up by event name only, so a page only reacts
 *     to the events it registers.
 *   - Failures here must never break the page — if EventSource isn't
 *     supported or the connection fails, the page just runs without
 *     live updates.
 *   - Debounced per event name (300ms) so a burst of related writes
 *     doesn't trigger a refetch storm.
 *
 * Usage (mirrors the original's connectLiveUpdates call):
 *
 *   useLiveUpdates({
 *     'students.changed': () => loadStudents(),
 *     'left-students.changed': () => loadStudents(),
 *   });
 */

'use client';

import { useEffect, useRef } from 'react';
import { getToken } from './api-client';

type Handlers = Record<string, () => void>;

export function useLiveUpdates(handlers: Handlers): void {
  // Keep the latest handlers in a ref so the effect doesn't need to
  // reconnect every time a page passes a new inline handler object.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const handlerKeys = Object.keys(handlers).sort().join(',');

  useEffect(() => {
    if (typeof EventSource === 'undefined') return; // very old browser — fail silently

    const token = getToken();
    if (!token) return; // the page's own auth guard will already have redirected to /login

    let source: EventSource;
    try {
      source = new EventSource(`${window.location.origin}/api/events?token=${encodeURIComponent(token)}`);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn('Live updates unavailable:', err?.message);
      return;
    }

    const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};

    const eventNames = Object.keys(handlersRef.current);
    const listeners: Array<[string, () => void]> = [];

    eventNames.forEach((eventName) => {
      const listener = () => {
        clearTimeout(debounceTimers[eventName]);
        debounceTimers[eventName] = setTimeout(() => {
          try {
            handlersRef.current[eventName]?.();
          } catch (err: any) {
            // eslint-disable-next-line no-console
            console.warn(`Live update handler for "${eventName}" failed:`, err?.message);
          }
        }, 300);
      };
      source.addEventListener(eventName, listener);
      listeners.push([eventName, listener]);
    });

    source.onerror = () => {
      // EventSource retries automatically; nothing to do here.
    };

    return () => {
      listeners.forEach(([eventName, listener]) => source.removeEventListener(eventName, listener));
      Object.values(debounceTimers).forEach(clearTimeout);
      try {
        source.close();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handlerKeys]);
}
