import { Inject, Injectable } from '@nestjs/common';
import type { Role } from '@nexa/shared';
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import { AppConfig, CONFIG } from '../config/config';
import { hashToken, randomToken } from '../common/crypto';
import { DB, Database, DbOrTx } from '../db/db.module';
import { memberships, sessions, users } from '../db/schema';

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  activeOrganizationId: string | null;
  /** Present only when the user is still a member of the active organisation. */
  role: Role | null;
}

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class SessionService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  get cookieName(): string {
    // __Host- prefix pins the cookie to this host, path=/ and Secure.
    return this.config.cookieSecure ? '__Host-nexa_session' : 'nexa_session';
  }

  cookieOptions(expires?: Date) {
    return {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax' as const,
      path: '/',
      ...(expires ? { expires } : {}),
    };
  }

  async create(
    userId: string,
    meta: { ip: string | null; userAgent: string | null; activeOrganizationId?: string | null },
    tx: DbOrTx = this.db,
  ): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + this.config.SESSION_TTL_HOURS * 3600_000);
    const [row] = await tx
      .insert(sessions)
      .values({
        tokenHash: hashToken(token, this.config.SESSION_SECRET),
        userId,
        activeOrganizationId: meta.activeOrganizationId ?? null,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
        expiresAt,
      })
      .returning({ id: sessions.id });
    return { token, sessionId: row!.id, expiresAt };
  }

  /** Resolve a raw cookie token to a live session, enforcing expiry, idle timeout and revocation. */
  async resolve(token: string): Promise<ResolvedSession | null> {
    if (!token || token.length > 100) return null;
    const now = new Date();
    const rows = await this.db
      .select({
        sessionId: sessions.id,
        userId: users.id,
        email: users.email,
        name: users.name,
        activeOrganizationId: sessions.activeOrganizationId,
        lastSeenAt: sessions.lastSeenAt,
        createdAt: sessions.createdAt,
        credentialsChangedAt: users.credentialsChangedAt,
        role: memberships.role,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .leftJoin(
        memberships,
        and(
          eq(memberships.userId, sessions.userId),
          eq(memberships.organizationId, sessions.activeOrganizationId),
        ),
      )
      .where(
        and(
          eq(sessions.tokenHash, hashToken(token, this.config.SESSION_SECRET)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
        ),
      )
      .limit(1);
    const s = rows[0];
    if (!s) return null;
    const idleLimit = this.config.SESSION_IDLE_HOURS * 3600_000;
    if (now.getTime() - s.lastSeenAt.getTime() > idleLimit) {
      await this.revoke(s.sessionId);
      return null;
    }
    // Sessions issued before a password change are invalid.
    if (s.createdAt.getTime() < s.credentialsChangedAt.getTime()) return null;
    if (now.getTime() - s.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, s.sessionId));
    }
    return {
      sessionId: s.sessionId,
      userId: s.userId,
      email: s.email,
      name: s.name,
      activeOrganizationId: s.role ? s.activeOrganizationId : null,
      role: s.role ?? null,
    };
  }

  async setActiveOrganization(
    sessionId: string,
    organizationId: string | null,
    tx: DbOrTx = this.db,
  ) {
    await tx
      .update(sessions)
      .set({ activeOrganizationId: organizationId })
      .where(eq(sessions.id, sessionId));
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  async revokeAllForUser(
    userId: string,
    exceptSessionId?: string,
    tx: DbOrTx = this.db,
  ): Promise<void> {
    const where = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
    if (exceptSessionId) where.push(ne(sessions.id, exceptSessionId));
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(...where));
  }
}
