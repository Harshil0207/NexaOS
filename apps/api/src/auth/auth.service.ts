import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  changePasswordSchema,
  LoginInput,
  permissionsForRole,
  RegisterInput,
  resetPasswordSchema,
} from '@nexa/shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { hashToken, randomToken } from '../common/crypto';
import { AppError, Errors } from '../common/errors';
import { isUniqueViolation } from '../common/pg-errors';
import type { AuthContext } from '../common/request-context';
import { AppConfig, CONFIG } from '../config/config';
import { DB, Database } from '../db/db.module';
import { memberships, organizations, passwordResetTokens, users } from '../db/schema';
import { MailService } from '../mail/mail.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MINUTES = 15;
const RESET_TOKEN_TTL_MIN = 60;

export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async register(input: RegisterInput, meta: ClientMeta) {
    const passwordHash = await this.passwords.hash(input.password);
    try {
      return await this.db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({ email: input.email, name: input.name, passwordHash })
          .returning({ id: users.id });
        const session = await this.sessions.create(user!.id, meta, tx);
        await this.audit.record(
          { kind: 'system', requestId: meta.requestId },
          { action: 'user.registered', resourceType: 'user', resourceId: user!.id },
          tx,
        );
        return session;
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw Errors.conflict('An account with this email already exists');
      throw err;
    }
  }

  async login(input: LoginInput, meta: ClientMeta) {
    const user = await this.db.query.users.findFirst({ where: eq(users.email, input.email) });
    const invalid = () => new AppError('UNAUTHENTICATED', 401, 'Invalid email or password');
    if (!user) {
      await this.passwords.verifyDummy(input.password);
      throw invalid();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.passwords.verifyDummy(input.password);
      throw new AppError('RATE_LIMITED', 429, 'Too many failed attempts. Try again later.');
    }
    const ok = await this.passwords.verify(user.passwordHash, input.password);
    if (!ok) {
      const failed = user.failedLoginCount + 1;
      await this.db
        .update(users)
        .set({
          failedLoginCount: sql`${users.failedLoginCount} + 1`,
          lockedUntil:
            failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
        })
        .where(eq(users.id, user.id));
      await this.audit.record(
        { kind: 'system', requestId: meta.requestId },
        {
          action: 'auth.login_failed',
          resourceType: 'user',
          resourceId: user.id,
          metadata: { ip: meta.ip },
        },
      );
      throw invalid();
    }
    // Default to the user's earliest organisation so they land somewhere useful.
    const firstMembership = await this.db.query.memberships.findFirst({
      where: eq(memberships.userId, user.id),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    });
    return this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
        .where(eq(users.id, user.id));
      const session = await this.sessions.create(
        user.id,
        { ...meta, activeOrganizationId: firstMembership?.organizationId ?? null },
        tx,
      );
      await this.audit.record(
        { kind: 'system', orgId: firstMembership?.organizationId, requestId: meta.requestId },
        { action: 'auth.login', resourceType: 'user', resourceId: user.id },
        tx,
      );
      return session;
    });
  }

  async logout(ctx: AuthContext) {
    await this.sessions.revoke(ctx.sessionId);
    await this.audit.record(
      { kind: 'user', ctx },
      { action: 'auth.logout', resourceType: 'session', resourceId: ctx.sessionId },
    );
  }

  async me(ctx: AuthContext, activeOrgId: string | null) {
    const orgs = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(eq(memberships.userId, ctx.userId))
      .orderBy(organizations.name);
    const active = orgs.find((o) => o.id === activeOrgId) ?? null;
    return {
      user: { id: ctx.userId, email: ctx.email, name: ctx.name },
      organizations: orgs,
      activeOrganization: active,
      permissions: active ? permissionsForRole(active.role) : [],
    };
  }

  /** Always resolves the same way whether or not the email exists (no account enumeration). */
  async requestPasswordReset(email: string, meta: ClientMeta): Promise<void> {
    const user = await this.db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) return;
    const token = randomToken();
    await this.db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: hashToken(token, this.config.SESSION_SECRET),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60_000),
    });
    const link = `${this.config.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
    const result = await this.mail
      .send({
        to: user.email,
        subject: 'Reset your NexaOS password',
        text: `Use this link within ${RESET_TOKEN_TTL_MIN} minutes to reset your password:\n\n${link}\n\nIf you did not request this, ignore this email.`,
      })
      .catch((err: unknown) => {
        this.logger.error({ err }, 'Password reset email failed');
        return { status: 'failed' as const };
      });
    if (result.status === 'unavailable' && this.config.NODE_ENV === 'development') {
      // Local development only: no SMTP configured, so surface the link to the developer console.
      this.logger.warn({ link }, 'SMTP not configured; password reset link (development only)');
    }
    await this.audit.record(
      { kind: 'system', requestId: meta.requestId },
      {
        action: 'auth.password_reset_requested',
        resourceType: 'user',
        resourceId: user.id,
        metadata: { delivery: result.status },
      },
    );
  }

  async resetPassword(input: z.infer<typeof resetPasswordSchema>, meta: ClientMeta): Promise<void> {
    const passwordHash = await this.passwords.hash(input.password);
    await this.db.transaction(async (tx) => {
      // Atomically consume the token: only one concurrent request can succeed.
      const [token] = await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(passwordResetTokens.tokenHash, hashToken(input.token, this.config.SESSION_SECRET)),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, new Date()),
          ),
        )
        .returning({ userId: passwordResetTokens.userId });
      if (!token)
        throw Errors.validation([
          { path: 'token', message: 'Reset link is invalid or has expired' },
        ]);
      await tx
        .update(users)
        .set({
          passwordHash,
          credentialsChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
        })
        .where(eq(users.id, token.userId));
      await this.sessions.revokeAllForUser(token.userId, undefined, tx);
      await this.audit.record(
        { kind: 'system', requestId: meta.requestId },
        { action: 'auth.password_reset', resourceType: 'user', resourceId: token.userId },
        tx,
      );
    });
  }

  async changePassword(ctx: AuthContext, input: z.infer<typeof changePasswordSchema>) {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, ctx.userId) });
    if (!user || !(await this.passwords.verify(user.passwordHash, input.currentPassword))) {
      throw Errors.validation([
        { path: 'currentPassword', message: 'Current password is incorrect' },
      ]);
    }
    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, ctx.userId));
      await this.sessions.revokeAllForUser(ctx.userId, ctx.sessionId, tx);
      await this.audit.record(
        { kind: 'user', ctx },
        { action: 'auth.password_changed', resourceType: 'user', resourceId: ctx.userId },
        tx,
      );
    });
  }

  async updateProfile(ctx: AuthContext, name: string) {
    await this.db.update(users).set({ name }).where(eq(users.id, ctx.userId));
    await this.audit.record(
      { kind: 'user', ctx },
      { action: 'user.profile_updated', resourceType: 'user', resourceId: ctx.userId },
    );
  }
}
