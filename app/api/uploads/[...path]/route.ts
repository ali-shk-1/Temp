import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { uploadsDir } from '@/lib/uploads';

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/* ─────────────────────────────────────────
   GET /api/uploads/[...path]
   Ported equivalent of server.js's `app.use('/uploads', express.static(...))`.
   Next.js has no direct equivalent for API routes, so this serves files
   manually. NOTE: the frontend originally referenced photo URLs as
   `/uploads/...` directly (not `/api/uploads/...`) — see nav.js/api.js.
   Either rewrite those references to `/api/uploads/...`, or add a
   next.config.js rewrite from `/uploads/:path*` to `/api/uploads/:path*`
   so existing photo_url values in the DB keep working unmodified.
───────────────────────────────────────── */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: pathSegments } = await params;

  // Guard against path traversal — reject any segment containing '..'.
  if (pathSegments.some((seg) => seg.includes('..'))) {
    return NextResponse.json({ error: 'Invalid path.' }, { status: 400 });
  }

  const filePath = path.join(uploadsDir, ...pathSegments);

  // Ensure the resolved path is still inside uploadsDir.
  if (!filePath.startsWith(uploadsDir)) {
    return NextResponse.json({ error: 'Invalid path.' }, { status: 400 });
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const buffer = fs.readFileSync(filePath);

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
