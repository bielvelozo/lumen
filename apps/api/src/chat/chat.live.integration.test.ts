import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createConnection, type Connection } from 'mysql2/promise';
import { createChatService } from './chat.service';
import { createMysql2QueryRunner } from '../query-registry/query-runner';
import type { OrgDataAccess } from '../query-registry/allow-list';
import type { ChatModelPort } from './chat-model';
import type { ChatStore } from './chat.store';
import type { FunctionLogStore, FunctionLogInput } from './function-log.store';
import type { AiConnectionStore, StoredAiConnection } from '../ai-connection/ai-connection.store';

// ---------------------------------------------------------------------------
// Live chat END-TO-END vs Docker MySQL — env-gated on MYSQL_URL (skips when absent). Required
// DB-facing test for spec 13 (RALPH 7(2)): the streamed figure must equal the value the query
// function returns directly against MySQL. The Postgres stores are in-memory fakes (not the
// DB-facing risk); the MySQL query runs through the REAL runner + real query-tools + real
// chat.service. The model is a FAKE port that picks the aggregate function and narrates the
// returned number — so the figure provably comes from the DB, not the model.
// ---------------------------------------------------------------------------
const TEST_DB = 'lumen_chat_e2e_test';

function rootConfig(): { host: string; port: number; user: string; password: string } {
  const url = new URL(process.env.MYSQL_URL ?? '');
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

describe.skipIf(!process.env.MYSQL_URL)('live: chat end-to-end', () => {
  let root: ReturnType<typeof rootConfig>;
  let admin: Connection | undefined;

  beforeAll(async () => {
    root = rootConfig();
    admin = await createConnection({ ...root, connectTimeout: 8000, multipleStatements: true });
    await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    await admin.query(`CREATE DATABASE \`${TEST_DB}\``);
    await admin.query(`USE \`${TEST_DB}\``);
    await admin.query('CREATE TABLE sales (id INT PRIMARY KEY, total DECIMAL(10,2), created_at DATETIME)');
    await admin.query(`INSERT INTO sales VALUES
      (1, 100.00, '2026-05-10 09:00:00'),
      (2, 250.00, '2026-05-20 09:00:00'),
      (3, 99.00, '2026-04-15 09:00:00')`); // April excluded -> May sum = 350
  }, 30_000);

  afterAll(async () => {
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
      await admin.end();
    }
  });

  it('answers with the EXACT DB-computed figure (number comes from MySQL, not the model)', async () => {
    const decrypt = (b: Buffer): string => b.toString('utf8').replace(/^enc:/, '');

    const access: OrgDataAccess = {
      connection: {
        connectionId: 'c1',
        status: 'active',
        host: root.host,
        port: root.port,
        databaseName: TEST_DB,
        username: root.user,
        sslEnabled: false,
        encryptedPassword: Buffer.from(`enc:${root.password}`),
      },
      allowList: {
        tables: new Map([['sales', new Map([['id', 'int'], ['total', 'decimal(10,2)'], ['created_at', 'datetime']])]]),
        relationships: [],
      },
    };

    const persisted: Array<{ role: string; content: string }> = [];
    const logs: FunctionLogInput[] = [];
    const chatStore: ChatStore = {
      createSession: async () => ({ id: 's1' }),
      getSessionForOrg: async () => ({ id: 's1', title: null }),
      touchSession: async () => undefined,
      insertUserMessage: async (m) => {
        persisted.push({ role: 'user', content: m.content });
        return { id: 'um' };
      },
      insertAssistantMessage: async (m) => {
        persisted.push({ role: 'assistant', content: m.content });
        return { id: 'am' };
      },
      recentMessages: async () => [{ role: 'user', content: 'quanto vendi em maio?' }],
    };
    const logStore: FunctionLogStore = { insert: async (row) => void logs.push(row) };
    const aiConnectionStore = {
      getByOrg: async (): Promise<StoredAiConnection> => ({
        id: 'ai1',
        encryptedApiKey: Buffer.from('enc:fake-key'),
        defaultModel: 'claude-opus-4-8',
        status: 'active',
      }),
    } as unknown as AiConnectionStore;

    // FAKE model: pick the aggregate tool, run it (REAL runner -> MySQL), narrate the number.
    const modelPort: ChatModelPort = {
      run: async (input, handlers) => {
        const tool = input.tools.find((t) => t.name === 'aggregate_over_time')!;
        const result = await tool.execute({
          table: 'sales',
          metric: { agg: 'sum', column: 'total' },
          dateColumn: 'created_at',
          grain: 'month',
          from: '2026-05-01',
          to: '2026-05-31',
        });
        if (!result.ok) return { outcome: 'error', category: 'unknown' };
        const value = Number(result.rows[0]?.value ?? 0);
        const text = `Você vendeu R$ ${value} em maio.`;
        handlers.onTextDelta(text);
        return { outcome: 'answered', text };
      },
    };

    const service = createChatService({
      chatStore,
      logStore,
      aiConnectionStore,
      allowListAccessor: { getByOrg: async () => access },
      runner: createMysql2QueryRunner({ decrypt }),
      modelPort,
      decrypt,
    });

    const chunks: string[] = [];
    const res = await service.sendMessage(
      { orgId: 'org-1', userId: 'user-1', sessionId: 's1', message: 'quanto vendi em maio?' },
      { onTextDelta: (d) => chunks.push(d) },
    );

    expect(res.outcome).toBe('answered');
    // The exact May sum from MySQL: 100 + 250 = 350.
    expect(chunks.join('')).toContain('350');
    expect(persisted.find((m) => m.role === 'assistant')?.content).toContain('350');
    // One success log, sanitized (no schema name / value).
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ functionName: 'aggregate_over_time', status: 'success' });
    expect(JSON.stringify(logs[0]?.params)).not.toContain('sales');
  }, 30_000);
});
