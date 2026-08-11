/**
 * components/Avatar.tsx
 *
 * Small round photo icon used in table rows (staff, students, fees,
 * receipts, tracking). Designed to never slow the table down:
 *
 *   - Fixed width/height set before the image loads, so there's zero
 *     layout shift and the table can paint immediately without waiting
 *     on any photo.
 *   - `loading="lazy"` + `decoding="async"`: the browser only fetches
 *     rows that actually scroll into view, and decodes off the main
 *     thread, so a table of 100+ rows doesn't fire 100+ eager image
 *     requests on mount.
 *   - Photo files are served with `Cache-Control: immutable` (see
 *     app/api/uploads/[...path]/route.ts), so after the first paint
 *     every repeat view — including switching tabs and coming back —
 *     is served straight from the browser's disk cache, no network.
 *   - On missing photo_url or a load error, falls back instantly to a
 *     plain initials badge — no broken-image icon, no layout jump.
 */

'use client';

import { useState } from 'react';

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: number;
}

export default function Avatar({ src, name, size = 32 }: AvatarProps) {
  const [failed, setFailed] = useState(false);

  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase() || '?';

  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    display: 'block',
    flexShrink: 0,
  };

  if (!src || failed) {
    return (
      <div
        style={{
          ...style,
          background: 'var(--avatar-bg, #e2e8f0)',
          color: 'var(--avatar-fg, #64748b)',
          fontSize: Math.max(10, size * 0.38),
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          userSelect: 'none',
        }}
        aria-label={name}
        title={name}
      >
        {initials}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      style={{ ...style, objectFit: 'cover' }}
    />
  );
}
