import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { makeDb, type Database } from '../db/client';
import { chatSessions, messages } from '../db/schema';
import { makeDrizzleChatStore, type ChatStore } from './chat.store';
import { makeDrizzleSignupStore } from '../auth/signup.store';

// ---------------------------------------------------------------------------
// Live chat-store integration — env-gated on DATABASE_URL. Skips when absent. Covers the
// ordering guarantees the orchestrator depends on: the model context window must come from
// the END of the conversation (an ascending LIMIT fed it the oldest turns and left out the
// question just asked), and the rendered history must stay chronological.
// ---------------------------------------------------------------------------
const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '..', '..', 'drizzle');
const TEST_DB = 'lumen_chat_store_test';

function withDatabase(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

describe.skipIf(!process.env.DATABASE_URL)('live: chat store', () => {
  let admin: Pool | undefined;
  let pool: Pool | undefined;
  let db: Database;
  let store: ChatStore;
  let orgId: string;
  let userId: string;
  let sessionId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL missing');
    admin = new Pool({ connectionString: withDatabase(url, 'postgres') });
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);

    const made = makeDb(withDatabase(url, TEST_DB));
    pool = made.pool;
    db = made.db;
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    store = makeDrizzleChatStore(db);

    const tenant = await makeDrizzleSignupStore(db).createTenant({
      email: 'chat-store@example.com',
      passwordHash: '$argon2id$placeholder',
      organizationName: 'Chat Store Co',
    });
    if (tenant.outcome !== 'created') throw new Error('failed to create test tenant');
    orgId = tenant.orgId;
    userId = tenant.userId;

    const created = await store.createSession({ orgId, userId, title: 'Longa' });
    sessionId = created.id;

    // 14 turns with explicit, strictly increasing timestamps — `defaultNow()` is the
    // transaction time, so a single batched insert would tie them all.
    const base = new Date('2026-06-18T12:00:00Z').getTime();
    await db.insert(messages).values(
      Array.from({ length: 14 }, (_, i) => ({
        sessionId,
        orgId,
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `turn-${i + 1}`,
        createdAt: new Date(base + i * 1000),
      })),
    );
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.end();
    }
  });

  it('recentMessages takes the window from the END and keeps it chronological', async () => {
    const history = await store.recentMessages(sessionId, orgId, 10);

    expect(history.map((m) => m.content)).toEqual([
      'turn-5',
      'turn-6',
      'turn-7',
      'turn-8',
      'turn-9',
      'turn-10',
      'turn-11',
      'turn-12',
      'turn-13',
      'turn-14',
    ]);
    // The whole point: the question just asked is in the model's context.
    expect(history.at(-1)?.content).toBe('turn-14');
  });

  it('getMessages returns the FULL history, oldest first (what the UI renders)', async () => {
    const all = await store.getMessages(sessionId, orgId);
    expect(all).not.toBeNull();
    expect(all).toHaveLength(14);
    expect(all?.[0]?.content).toBe('turn-1');
    expect(all?.at(-1)?.content).toBe('turn-14');
  });

  it('is org-scoped: another org sees neither the history nor the session', async () => {
    const other = await makeDrizzleSignupStore(db).createTenant({
      email: 'other-org@example.com',
      passwordHash: '$argon2id$placeholder',
      organizationName: 'Other Co',
    });
    if (other.outcome !== 'created') throw new Error('failed to create the other tenant');

    expect(await store.recentMessages(sessionId, other.orgId, 10)).toEqual([]);
    expect(await store.getMessages(sessionId, other.orgId)).toBeNull();
    expect(await store.getSessionForOrg(sessionId, other.orgId)).toBeNull();
  });

  it('touchSession titles a session only on the first message', async () => {
    const fresh = await store.createSession({ orgId, userId, title: null });
    await store.touchSession(fresh.id, orgId, 'Primeiro assunto');
    await store.touchSession(fresh.id, orgId, 'Segundo assunto');

    const rows = await db.select().from(chatSessions);
    expect(rows.find((r) => r.id === fresh.id)?.title).toBe('Primeiro assunto');
  });
});
