/**
 * lib/sse.ts — ported from backend/sse.js.
 *
 * Same in-memory, single-process design as the original (see original
 * comment below, preserved). Next.js API routes can return a streaming
 * Response using a ReadableStream controller in place of Express's
 * long-lived `res` object.
 *
 * Deliberately in-memory and dependency-free:
 *   - Fine for a single Node process (which is what this app runs as).
 *   - If this app is ever scaled to multiple server processes/instances
 *     behind a load balancer, this in-memory list won't see events
 *     broadcast from other instances — at that point swap to a Redis
 *     pub/sub channel instead. Not needed at current scale.
 *   - If a broadcast call throws or a client write fails, it's caught and
 *     logged — it must never crash the request that triggered it, since
 *     the actual DB write already succeeded by the time we broadcast.
 *
 * IMPORTANT (Next.js specific): this in-memory Set only works reliably
 * with a persistent Node.js server (e.g. `next start`, or a custom
 * server). It will NOT work correctly on serverless/edge deployments
 * where each request may hit a different process — same caveat as the
 * original had for multi-instance scaling, just arriving sooner here.
 */

type SseClient = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  user_id?: number;
  role?: string;
};

const clients = new Set<SseClient>();
const encoder = new TextEncoder();

export function createSseStream(user?: { user_id?: number; role?: string }): ReadableStream<Uint8Array> {
  let client: SseClient;
  let heartbeat: ReturnType<typeof setInterval>;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      client = { controller, user_id: user?.user_id, role: user?.role };
      clients.add(client);

      // Retry hint + comment ping, mirrors the original.
      controller.enqueue(encoder.encode('retry: 3000\n'));
      controller.enqueue(encoder.encode(': connected\n\n'));

      // Heartbeat every 25s so idle-timeout proxies/load balancers don't
      // silently drop the connection between real events.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25000);
    },
    cancel() {
      clearInterval(heartbeat);
      clients.delete(client);
    },
  });
}

export function broadcast(event: string, data: unknown = {}): void {
  const payload = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  for (const client of clients) {
    try {
      client.controller.enqueue(payload);
    } catch {
      // Dead connection — drop it, don't let one bad client break the loop.
      clients.delete(client);
    }
  }
}
