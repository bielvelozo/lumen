import { useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GlassPanel, Button } from '../../design-system/ui';
import { useSessions, CHAT_KEYS } from '../../lib/chat-queries';
import { renameSession } from '../../lib/chat';

/**
 * The sessions list. GLASS is allowed here — it is chrome (sidebar), per glass-only-on-chrome.
 * Sessions come back already org-scoped + `updated_at` desc; the client preserves that order.
 * Rename is an optimistic-ish inline edit that invalidates the list (order unchanged).
 */
export function SessionSidebar({ activeId }: { activeId?: string }): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessions = useSessions();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameSession(id, title),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHAT_KEYS.sessions }),
  });

  const commitRename = (id: string): void => {
    const title = draft.trim();
    setEditingId(null);
    if (title.length > 0) rename.mutate({ id, title });
  };

  const onEditKey = (e: KeyboardEvent<HTMLInputElement>, id: string): void => {
    if (e.key === 'Enter') commitRename(id);
    if (e.key === 'Escape') setEditingId(null);
  };

  return (
    <GlassPanel
      as="aside"
      style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderRadius: 16, minWidth: 220, minHeight: 0 }}
    >
      <Button type="button" onClick={() => navigate('/chat')}>
        Nova conversa
      </Button>
      <nav
        aria-label="Conversas"
        style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8, flex: 1, minHeight: 0, overflowY: 'auto' }}
      >
        {sessions.isPending && <p style={{ color: 'var(--c-text-2)', fontSize: 13 }}>Carregando…</p>}
        {sessions.data?.length === 0 && (
          <p style={{ color: 'var(--c-text-2)', fontSize: 13 }}>Nenhuma conversa ainda.</p>
        )}
        {sessions.data?.map((s) =>
          editingId === s.id ? (
            <input
              key={s.id}
              aria-label="Renomear conversa"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => onEditKey(e, s.id)}
              onBlur={() => commitRename(s.id)}
              style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--c-border)' }}
            />
          ) : (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                aria-current={s.id === activeId ? 'page' : undefined}
                onClick={() => navigate(`/chat/${s.id}`)}
                style={{
                  flex: 1,
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: 0,
                  cursor: 'pointer',
                  background: s.id === activeId ? 'var(--c-surface-2)' : 'transparent',
                  color: 'var(--c-text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {s.title ?? 'Nova conversa'}
              </button>
              <button
                type="button"
                aria-label={`Renomear ${s.title ?? 'conversa'}`}
                onClick={() => {
                  setEditingId(s.id);
                  setDraft(s.title ?? '');
                }}
                style={{ border: 0, background: 'transparent', color: 'var(--c-text-3)', cursor: 'pointer', fontSize: 13 }}
              >
                renomear
              </button>
            </div>
          ),
        )}
      </nav>
    </GlassPanel>
  );
}
