import type { Response } from 'express';

/** Minimal SSE writer with heartbeats; returns a cleanup function. */
export function openSse(res: Response, onClose: () => void) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    onClose();
  };
  res.on('close', close);
  return {
    send(event: string, data: unknown, id?: string | number) {
      if (closed) return;
      res.write(
        `${id !== undefined ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
      );
    },
    close() {
      close();
      res.end();
    },
  };
}
