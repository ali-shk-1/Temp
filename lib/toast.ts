/**
 * lib/toast.ts
 *
 * Port of showToast(msg, type) from api.js. The original manipulated a
 * single #toast div directly; here <ToastHost/> (in components/ToastHost.tsx)
 * owns that div's React state and listens for a DOM CustomEvent, so any
 * page can call showToast(...) exactly like before without prop drilling.
 */

'use client';

export type ToastType = 'success' | 'error';

export const TOAST_EVENT = 'app:toast';

export interface ToastDetail {
  msg: string;
  type: ToastType;
}

export function showToast(msg: string, type: ToastType = 'success'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail: { msg, type } }));
}
