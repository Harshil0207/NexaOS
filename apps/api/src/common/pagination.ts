import { Errors } from './errors';

/** Opaque keyset cursor over (createdAt, id). */
export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.createdAt.toISOString(), c.id])).toString('base64url');
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const [iso, id] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as [
      string,
      string,
    ];
    const createdAt = new Date(iso);
    if (
      Number.isNaN(createdAt.getTime()) ||
      typeof id !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(id)
    ) {
      throw new Error('bad cursor');
    }
    return { createdAt, id };
  } catch {
    throw Errors.validation([{ path: 'cursor', message: 'Invalid cursor' }]);
  }
}

export function page<T extends { createdAt: Date; id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(last) : null };
}
