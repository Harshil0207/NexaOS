import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { customers } from '../../db/schema';
import { defineTool, ToolError } from '../tool.types';

export const sendCustomerEmailTool = defineTool({
  key: 'sendCustomerEmail',
  name: 'Send customer email',
  description:
    'Send a plain-text email to an existing customer of this organisation (recipient must be a known customer email).',
  kind: 'MUTATION',
  permission: 'records:write',
  // Not auto-retried: SMTP delivery cannot be deduplicated reliably.
  idempotent: false,
  defaultEnabled: false,
  risk: 'high',
  input: z.object({
    to: z.string().trim().toLowerCase().pipe(z.email()),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(10_000),
  }),
  output: z.object({ status: z.literal('sent'), messageId: z.string() }),
  availability: (config) =>
    config.SMTP_URL
      ? { available: true }
      : { available: false, reason: 'SMTP_URL is not configured' },
  async execute(input, ctx) {
    const customer = await ctx.deps.db.query.customers.findFirst({
      where: and(eq(customers.organizationId, ctx.orgId), eq(customers.email, input.to)),
    });
    if (!customer)
      throw new ToolError(
        'RECIPIENT_NOT_ALLOWED',
        'Recipient is not a customer of this organisation',
      );
    const r = await ctx.deps.mail.send({ to: input.to, subject: input.subject, text: input.body });
    if (r.status !== 'sent') throw new ToolError('EMAIL_UNAVAILABLE', r.reason);
    return { status: 'sent' as const, messageId: r.messageId };
  },
});
