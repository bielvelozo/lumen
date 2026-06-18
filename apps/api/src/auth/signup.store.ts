import { organizations, users } from '../db/schema';
import type { Database } from '../db/client';

/**
 * Input for creating a tenant. `passwordHash` is already an argon2id PHC string — the
 * store never sees or hashes a raw password. `email` and `organizationName` are the
 * normalized values from the shared signup contract.
 */
export interface CreateTenantInput {
  email: string;
  passwordHash: string;
  organizationName: string;
}

/** Outcome of a tenant-creation attempt — `duplicate` carries no detail (anti-enumeration). */
export type CreateTenantResult =
  | { outcome: 'created'; orgId: string; userId: string }
  | { outcome: 'duplicate' };

/**
 * Persistence port for signup. Implemented by {@link makeDrizzleSignupStore} over a real
 * transaction; faked in unit tests. The atomicity + unique-email guarantees live here so
 * the service stays pure orchestration.
 */
export interface SignupStore {
  createTenant(input: CreateTenantInput): Promise<CreateTenantResult>;
}

/** PostgreSQL `unique_violation`. */
const PG_UNIQUE_VIOLATION = '23505';

/** True if the error is a Postgres unique-constraint violation (e.g. duplicate email). */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

/**
 * Drizzle-backed signup store. Creates the `organizations` row then the `owner` `users`
 * row inside ONE transaction: any failure rolls both back (never a dangling org or an
 * ownerless tenant). A duplicate email surfaces as a `23505` on the owner insert — the
 * transaction rolls back (so the org insert is undone too) and we return `duplicate`,
 * relying on the DB UNIQUE constraint rather than a racy pre-`SELECT`.
 */
export function makeDrizzleSignupStore(db: Database): SignupStore {
  return {
    async createTenant(input: CreateTenantInput): Promise<CreateTenantResult> {
      try {
        const created = await db.transaction(async (tx) => {
          const orgRows = await tx
            .insert(organizations)
            .values({ name: input.organizationName })
            .returning({ id: organizations.id });
          const org = orgRows[0];
          if (!org) throw new Error('org insert returned no row');

          const userRows = await tx
            .insert(users)
            .values({
              orgId: org.id,
              email: input.email,
              passwordHash: input.passwordHash,
              role: 'owner',
              emailVerified: false,
            })
            .returning({ id: users.id });
          const user = userRows[0];
          if (!user) throw new Error('user insert returned no row');

          return { orgId: org.id, userId: user.id };
        });
        return { outcome: 'created', orgId: created.orgId, userId: created.userId };
      } catch (error) {
        if (isUniqueViolation(error)) return { outcome: 'duplicate' };
        throw error;
      }
    },
  };
}
