'use client';

/**
 * app/login/page.tsx — direct port of frontend/login.html.
 * Same fields, same validation message, same error message extraction,
 * same redirect-if-already-logged-in behavior, same sessionStorage keys.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/api-client';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (getToken()) {
      router.replace('/dashboard');
    }
  }, [router]);

  async function doLogin() {
    const u = username.trim();
    const p = password;
    setError('');

    if (!u || !p) {
      setError('Please enter username and password.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(window.location.origin + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Login failed');

      sessionStorage.setItem('token', data.token);
      sessionStorage.setItem('user', JSON.stringify(data.user));
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-box">
        <div className="login-logo">
          <img src="/icon-192.png" alt="" className="login-logo-icon" />
          School Management
        </div>
        <p className="login-sub">Administrator Login</p>

        <div className="form-group">
          <label htmlFor="username">Username</label>
          <input
            type="text"
            id="username"
            placeholder="Enter username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            ref={passwordRef}
            type="password"
            id="password"
            placeholder="Enter password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doLogin();
            }}
          />
        </div>
        <button className="login-btn" id="loginBtn" disabled={submitting} onClick={doLogin}>
          {submitting ? 'Signing in…' : 'Sign In'}
        </button>
        <p className="login-error" id="loginError">
          {error}
        </p>
      </div>
    </div>
  );
}
