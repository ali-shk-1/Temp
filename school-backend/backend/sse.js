/**
 * sse.js — minimal Server-Sent Events broker for live cross-tab updates.
 *
 * How it fits in:
 *   - server.js mounts GET /api/events, which calls addClient(req, res)
 *     to register a connection and keep it open.
 *   - Any route that successfully inserts/updates/deletes data calls
 *     broadcast(event, payload) right after the DB write. Every currently
 *     open /api/events connection receives it instantly.
 *   - Frontend opens `new EventSource(...)` once per page and listens for
 *     the events it cares about (see events.js), then re-fetches just the
 *     relevant list. Nothing here pushes data directly to the DOM — it
 *     only tells the frontend "something changed, go refetch."
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
 */

// Set of currently-connected response objects, each tagged with the
// user_id/role that opened them (kept in case future events need to be
// scoped to specific users; every event today is broadcast to everyone).
const clients = new Set();

function addClient(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Allow the browser's EventSource (which can't send custom headers)
    // to work through the same CORS setup as the rest of the API.
    'X-Accel-Buffering': 'no', // prevents some reverse proxies from buffering the stream
  });

  // Comment ping so proxies/browsers treat the connection as alive
  // immediately, and a named retry hint so EventSource's built-in
  // auto-reconnect backs off sensibly if the connection drops.
  res.write('retry: 3000\n');
  res.write(': connected\n\n');

  const client = { res, user_id: req.user?.user_id, role: req.user?.role };
  clients.add(client);

  // Heartbeat comment every 25s so the connection isn't silently dropped
  // by idle-timeout proxies/load balancers between real events.
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (err) {
      clearInterval(heartbeat);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(client);
  });
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data || {})}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(payload);
    } catch (err) {
      // Dead connection — drop it, don't let one bad client break the loop.
      clients.delete(client);
    }
  }
}

module.exports = { addClient, broadcast };
