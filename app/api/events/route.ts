import { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { createSseStream } from '@/lib/sse';

/* ── Live updates (Server-Sent Events) ───
   Ported from server.js: app.get('/api/events', authenticate, addClient) */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  const stream = createSseStream({ user_id: auth.user.user_id, role: auth.user.role });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
