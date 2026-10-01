import { z } from 'zod';
import { ROLES } from '../permissions';
import { email } from './auth';
import { safeText, uuid } from './common';

export const createOrganizationSchema = z.object({
  name: safeText(100),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const switchOrganizationSchema = z.object({ organizationId: uuid });

export const addMemberSchema = z.object({
  email,
  role: z.enum(ROLES).refine((r) => r !== 'OWNER', 'Ownership cannot be granted by invitation'),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const changeRoleSchema = z.object({ role: z.enum(ROLES) });
