import { z } from 'zod';

export const uuid = z.uuid();

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

// eslint-disable-next-line no-control-regex -- intentionally matching control characters to reject them
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

/** Trimmed, non-empty, bounded text with no control characters. */
export const safeText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !CONTROL_CHARS.test(s), 'Contains control characters');
