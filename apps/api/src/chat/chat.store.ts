import { and, asc, eq, sql } from 'drizzle-orm';
import type { MessageRole } from '@lumen/shared';
import { chatSessions, messages } from '../db/schema';
import type { Database } from '../db/client';

export interface ChatStore {
  /** Create a session owned by the caller's org+user. */
  createSession(input: { orgId: string; userId: string; title: string | null }): Promise<{ id: string }>;
  /** Ownership check: returns the session ONLY if it belongs to `orgId` (else null → 404). */
  getSessionForOrg(sessionId: string, orgId: string): Promise<{ id: string; title: string | null } | null>;
  /** Bump `updated_at`; set `title` only if currently null (first message). Org-scoped. */
  touchSession(sessionId: string, orgId: string, title?: string): Promise<void>;
  insertUserMessage(input: { sessionId: string; orgId: string; content: string }): Promise<{ id: string }>;
  insertAssistantMessage(input: {
    sessionId: string;
    orgId: string;
    content: string;
    model: string;
  }): Promise<{ id: string }>;
  /** Recent turns (oldest-first) for model context, bounded. Org-scoped. */
  recentMessages(
    sessionId: string,
    orgId: string,
    limit: number,
  ): Promise<{ role: MessageRole; content: string }[]>;
}

export function makeDrizzleChatStore(db: Database): ChatStore {
  return {
    async createSession(input) {
      const rows = await db
        .insert(chatSessions)
        .values({ orgId: input.orgId, userId: input.userId, title: input.title })
        .returning({ id: chatSessions.id });
      return { id: rows[0]!.id };
    },

    async getSessionForOrg(sessionId, orgId) {
      const rows = await db
        .select({ id: chatSessions.id, title: chatSessions.title })
        .from(chatSessions)
        .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.orgId, orgId)))
        .limit(1);
      return rows[0] ?? null;
    },

    async touchSession(sessionId, orgId, title) {
      await db
        .update(chatSessions)
        .set(
          title === undefined
            ? { updatedAt: new Date() }
            : { updatedAt: new Date(), title: sql`COALESCE(${chatSessions.title}, ${title})` },
        )
        .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.orgId, orgId)));
    },

    async insertUserMessage(input) {
      const rows = await db
        .insert(messages)
        .values({ sessionId: input.sessionId, orgId: input.orgId, role: 'user', content: input.content })
        .returning({ id: messages.id });
      return { id: rows[0]!.id };
    },

    async insertAssistantMessage(input) {
      const rows = await db
        .insert(messages)
        .values({
          sessionId: input.sessionId,
          orgId: input.orgId,
          role: 'assistant',
          content: input.content,
          model: input.model,
        })
        .returning({ id: messages.id });
      return { id: rows[0]!.id };
    },

    async recentMessages(sessionId, orgId, limit) {
      const rows = await db
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .where(and(eq(messages.sessionId, sessionId), eq(messages.orgId, orgId)))
        .orderBy(asc(messages.createdAt))
        .limit(limit);
      return rows;
    },
  };
}
