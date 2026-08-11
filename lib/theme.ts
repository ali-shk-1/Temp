/**
 * lib/theme.ts — port of initTheme()/toggleTheme() from nav.js.
 * initTheme() is also invoked inline in app/layout.tsx (as a
 * dangerouslySetInnerHTML <script>) to avoid a flash of the wrong theme,
 * exactly like the original's inline <head> snippet on every page.
 */

'use client';

export function initTheme(): 'light' | 'dark' {
  // App default is always light on first visit, regardless of OS/browser
  // color-scheme preference. Once a user explicitly toggles the theme,
  // that explicit choice (in localStorage) is respected on every later visit.
  const theme = (localStorage.getItem('theme') as 'light' | 'dark' | null) || 'light';
  document.documentElement.setAttribute('data-theme', theme);
  return theme;
}

export function toggleTheme(): void {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
}

/** Inline script source injected in <head> to set the theme before paint, matching the original's per-page inline snippet. */
export const THEME_INIT_SCRIPT = `(function(){
  var t = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
})();`;
