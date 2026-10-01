import type { Permission, Role } from '@nexa/shared';
import type { Request } from 'express';

/** Authenticated identity resolved server-side from the session. Never from client input. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  email: string;
  name: string;
  requestId: string;
  ip: string | null;
}

/** Auth context plus the verified active organisation membership. */
export interface OrgContext extends AuthContext {
  orgId: string;
  role: Role;
  permissions: ReadonlySet<Permission>;
}

export interface NexaRequest extends Request {
  id: string;
  auth?: AuthContext;
  org?: OrgContext;
}
