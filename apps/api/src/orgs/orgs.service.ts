import { Inject, Injectable } from '@nestjs/common';
import { AddMemberInput, Role, ROLE_RANK } from '@nexa/shared';
import { and, asc, count, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { Errors } from '../common/errors';
import { isUniqueViolation } from '../common/pg-errors';
import type { AuthContext, OrgContext } from '../common/request-context';
import { randomToken } from '../common/crypto';
import { DB, Database, Tx } from '../db/db.module';
import { memberships, organizations, users } from '../db/schema';

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'org'}-${randomToken(4)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 5)}`;
}

@Injectable()
export class OrgsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async create(ctx: AuthContext, name: string) {
    return this.db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ name, slug: slugify(name) })
        .returning();
      await tx
        .insert(memberships)
        .values({ organizationId: org!.id, userId: ctx.userId, role: 'OWNER' });
      await this.sessions.setActiveOrganization(ctx.sessionId, org!.id, tx);
      await this.audit.record(
        { kind: 'user', ctx, orgId: org!.id },
        {
          action: 'organization.created',
          resourceType: 'organization',
          resourceId: org!.id,
          metadata: { name },
        },
        tx,
      );
      return org!;
    });
  }

  /** Switching re-verifies membership server-side; the client-supplied id is never trusted alone. */
  async switch(ctx: AuthContext, organizationId: string) {
    const m = await this.db.query.memberships.findFirst({
      where: and(
        eq(memberships.userId, ctx.userId),
        eq(memberships.organizationId, organizationId),
      ),
    });
    if (!m) throw Errors.notFound('Organisation');
    await this.sessions.setActiveOrganization(ctx.sessionId, organizationId);
    await this.audit.record(
      { kind: 'user', ctx, orgId: organizationId },
      { action: 'organization.switched', resourceType: 'organization', resourceId: organizationId },
    );
  }

  async current(ctx: OrgContext) {
    const org = await this.db.query.organizations.findFirst({
      where: eq(organizations.id, ctx.orgId),
    });
    if (!org) throw Errors.notFound('Organisation');
    return { ...org, role: ctx.role, permissions: [...ctx.permissions] };
  }

  async rename(ctx: OrgContext, name: string) {
    await this.db.transaction(async (tx) => {
      await tx.update(organizations).set({ name }).where(eq(organizations.id, ctx.orgId));
      await this.audit.record(
        { kind: 'user', ctx },
        {
          action: 'organization.renamed',
          resourceType: 'organization',
          resourceId: ctx.orgId,
          metadata: { name },
        },
        tx,
      );
    });
  }

  listMembers(ctx: OrgContext) {
    return this.db
      .select({
        id: memberships.id,
        userId: users.id,
        name: users.name,
        email: users.email,
        role: memberships.role,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, ctx.orgId))
      .orderBy(asc(memberships.createdAt));
  }

  /** Adds an existing registered user. Invitation emails for unregistered users are a later phase. */
  async addMember(ctx: OrgContext, input: AddMemberInput) {
    this.assertCanGrant(ctx.role, input.role);
    const user = await this.db.query.users.findFirst({ where: eq(users.email, input.email) });
    if (!user) throw Errors.notFound('Registered user with that email');
    try {
      return await this.db.transaction(async (tx) => {
        const [m] = await tx
          .insert(memberships)
          .values({ organizationId: ctx.orgId, userId: user.id, role: input.role })
          .returning();
        await this.audit.record(
          { kind: 'user', ctx },
          {
            action: 'member.added',
            resourceType: 'membership',
            resourceId: m!.id,
            metadata: { userId: user.id, role: input.role },
          },
          tx,
        );
        return m!;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw Errors.conflict('User is already a member');
      throw err;
    }
  }

  async isOwnMembership(ctx: OrgContext, membershipId: string): Promise<boolean> {
    const m = await this.db.query.memberships.findFirst({
      where: and(eq(memberships.id, membershipId), eq(memberships.organizationId, ctx.orgId)),
      columns: { userId: true },
    });
    return m?.userId === ctx.userId;
  }

  async changeRole(ctx: OrgContext, membershipId: string, role: Role) {
    await this.db.transaction(async (tx) => {
      const target = await this.lockMember(tx, ctx, membershipId);
      if (target.userId === ctx.userId) throw Errors.forbidden('You cannot change your own role');
      this.assertCanManage(ctx.role, target.role);
      this.assertCanGrant(ctx.role, role);
      if (target.role === 'OWNER' && role !== 'OWNER') await this.assertNotLastOwner(tx, ctx.orgId);
      await tx.update(memberships).set({ role }).where(eq(memberships.id, membershipId));
      await this.audit.record(
        { kind: 'user', ctx },
        {
          action: 'member.role_changed',
          resourceType: 'membership',
          resourceId: membershipId,
          metadata: { from: target.role, to: role, userId: target.userId },
        },
        tx,
      );
    });
  }

  async removeMember(ctx: OrgContext, membershipId: string) {
    await this.db.transaction(async (tx) => {
      const target = await this.lockMember(tx, ctx, membershipId);
      if (target.userId !== ctx.userId) this.assertCanManage(ctx.role, target.role);
      if (target.role === 'OWNER') await this.assertNotLastOwner(tx, ctx.orgId);
      await tx.delete(memberships).where(eq(memberships.id, membershipId));
      await this.audit.record(
        { kind: 'user', ctx },
        {
          action: 'member.removed',
          resourceType: 'membership',
          resourceId: membershipId,
          metadata: { userId: target.userId, role: target.role },
        },
        tx,
      );
    });
  }

  private async lockMember(tx: Tx, ctx: OrgContext, membershipId: string) {
    const [row] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, ctx.orgId)))
      .for('update');
    if (!row) throw Errors.notFound('Member');
    return row;
  }

  private assertCanGrant(actor: Role, role: Role) {
    // Owners may grant any role; everyone else only roles strictly below their own.
    if (actor !== 'OWNER' && ROLE_RANK[role] >= ROLE_RANK[actor]) {
      throw Errors.forbidden('You can only grant roles below your own');
    }
  }

  private assertCanManage(actor: Role, target: Role) {
    if (actor !== 'OWNER' && ROLE_RANK[target] >= ROLE_RANK[actor]) {
      throw Errors.forbidden('You cannot manage a member with an equal or higher role');
    }
  }

  private async assertNotLastOwner(tx: Tx, orgId: string) {
    const [row] = await tx
      .select({ n: count() })
      .from(memberships)
      .where(and(eq(memberships.organizationId, orgId), eq(memberships.role, 'OWNER')));
    if ((row?.n ?? 0) <= 1) throw Errors.conflict('An organisation must keep at least one owner');
  }
}
