import type { Response } from 'express';

const userStreams = new Map<string, Set<Response>>();

export function attachWorkspaceStream(userId: string, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let set = userStreams.get(userId);
  if (!set) {
    set = new Set();
    userStreams.set(userId, set);
  }
  set.add(res);

  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, ts: Date.now() })}\n\n`);

  const keepalive = setInterval(() => {
    try {
      res.write(`: keepalive ${Date.now()}\n\n`);
    } catch {
      clearInterval(keepalive);
    }
  }, 25000);

  res.on('close', () => {
    clearInterval(keepalive);
    const current = userStreams.get(userId);
    if (current) {
      current.delete(res);
      if (current.size === 0) {
        userStreams.delete(userId);
      }
    }
  });
}

export function notifyWorkspaceChange(userId: string, collections: string[]): void {
  const set = userStreams.get(userId);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify({
    type: 'workspace_updated',
    collections,
    ts: Date.now(),
  });
  for (const res of set) {
    try {
      res.write(`event: sync\ndata: ${payload}\n\n`);
    } catch {
      // Closed socket will be cleaned up on 'close'
    }
  }
}

export function closeAllWorkspaceStreams(): void {
  for (const set of userStreams.values()) {
    for (const res of set) {
      try {
        res.end();
      } catch {
        // ignore already closed socket
      }
    }
  }
  userStreams.clear();
}
