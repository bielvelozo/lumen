import { resolve } from 'node:path';
import { config } from 'dotenv';
import { makeDb } from './client';
import { hashPassword } from '../crypto';
import { organizations, users } from './schema';

// Dev-only seed. Idempotent via fixed UUIDs. The demo owner gets a REAL argon2 password hash
// so you can actually log in with the creds printed at the end. It seeds NO connection rows:
// a db/ai connection whose secret was never encrypted with the running key is undecryptable,
// which showed the owner a "connected" dashboard that failed on every action. The demo owner
// goes through the real onboarding instead. Run via `pnpm db:seed`.
config({ path: resolve(import.meta.dirname, '..', '..', '..', '..', '.env') });

const DEMO_ORG_ID = '00000000-0000-0000-0000-000000000001';
const DEMO_USER_ID = '00000000-0000-0000-0000-000000000002';

// Demo owner login (dev only). Override via the DEMO_PASSWORD env var if you like.
const DEMO_EMAIL = 'owner@demo.lumen.local';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'LumenDev!2026';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required to seed.');
    process.exit(1);
  }

  const { db, pool } = makeDb(databaseUrl);
  try {
    await db
      .insert(organizations)
      .values({ id: DEMO_ORG_ID, name: 'Demo Org' })
      .onConflictDoNothing();

    // Real argon2 hash so the demo owner can actually log in. Upsert so a previously
    // seeded user (e.g. with the old placeholder hash) gets refreshed in place.
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    await db
      .insert(users)
      .values({
        id: DEMO_USER_ID,
        orgId: DEMO_ORG_ID,
        email: DEMO_EMAIL,
        passwordHash,
        role: 'owner',
        emailVerified: true,
      })
      .onConflictDoUpdate({ target: users.id, set: { passwordHash, emailVerified: true } });

    console.log('Seed complete: demo org + owner user (no connection rows — use the onboarding).');
    console.log(`Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
