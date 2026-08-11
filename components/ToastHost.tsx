/**
 * components/ToastHost.tsx
 *
 * Owns the single #toast div (matching the original's `<div id="toast"
 * class="toast">` present on every page) and reacts to showToast() calls
 * dispatched anywhere via lib/toast.ts. Mount once, in the authenticated
 * layout, alongside <NavBar/>.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { TOAST_EVENT, ToastDetail } from '@/lib/toast';

export default function ToastHost() {
  const [msg, setMsg] = useState('');
  const [type, setType] = useState<'success' | 'error'>('success');
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ToastDetail>).detail;
      if (!detail) return;
      setMsg(detail.msg);
      setType(detail.type);
      setVisible(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setVisible(false), 3000);
    };
    window.addEventListener(TOAST_EVENT, handler);
    return () => {
      window.removeEventListener(TOAST_EVENT, handler);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div id="toast" className={`toast toast-${type}${visible ? ' show' : ''}`}>
      {msg}
    </div>
  );
}
