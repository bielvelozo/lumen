import { useRef, useState, type KeyboardEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CLAUDE_MODELS, DEFAULT_MODEL, type ClaudeModelId, type ChatErrorCode } from '@lumen/shared';
import { GlassPanel, Card, ChatBubble, Button } from '../../design-system/ui';
import { useMessages, useChatReadiness, CHAT_KEYS } from '../../lib/chat-queries';
import { createSession, streamMessage } from '../../lib/chat';
import { SessionSidebar } from './SessionSidebar';
import { Markdown } from './Markdown';
import { GatingPanel, ErrorPanel, EmptyConversation } from './states';

interface StreamState {
  userText: string | null;
  assistantText: string;
  inFlight: boolean;
  error: { code: ChatErrorCode; message: string } | null;
}

const IDLE: StreamState = { userText: null, assistantText: '', inFlight: false, error: null };

/**
 * The chat — mounted at `/chat` and `/chat/:sessionId` (same element, so an in-flight stream
 * survives the create-then-navigate on the first message). Two panes: a GLASS sessions sidebar
 * (chrome) and a SOLID conversation column (bubbles, numbers) with a GLASS input pinned at the
 * bottom. No data/number/answer ever renders on glass. The client sends only a `session_id`.
 */
export function ChatPage(): JSX.Element {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const readiness = useChatReadiness();
  const messages = useMessages(sessionId);

  const [input, setInput] = useState('');
  const [stream, setStream] = useState<StreamState>(IDLE);
  const [model, setModel] = useState<ClaudeModelId>(DEFAULT_MODEL);
  const [modelInit, setModelInit] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Default the switcher to the org's default_model the first time readiness loads.
  if (!modelInit && !readiness.isPending) {
    if (readiness.aiDefaultModel) setModel(readiness.aiDefaultModel);
    setModelInit(true);
  }

  async function send(text: string): Promise<void> {
    const message = text.trim();
    if (message.length === 0 || stream.inFlight) return;
    setInput('');
    setStream({ userText: message, assistantText: '', inFlight: true, error: null });

    const abort = new AbortController();
    abortRef.current = abort;

    let sid = sessionId;
    try {
      if (!sid) {
        const created = await createSession();
        sid = created.id;
        await queryClient.invalidateQueries({ queryKey: CHAT_KEYS.sessions });
        navigate(`/chat/${sid}`);
      }

      let errored: { code: ChatErrorCode; message: string } | null = null;
      for await (const ev of streamMessage(sid, { message, model }, abort.signal)) {
        if (ev.type === 'text-delta') {
          setStream((s) => ({ ...s, assistantText: s.assistantText + ev.delta }));
        } else if (ev.type === 'error') {
          errored = { code: ev.code, message: ev.message };
        }
      }

      // Canonical server state wins: refetch the persisted messages + the (re-ordered) list.
      await queryClient.invalidateQueries({ queryKey: CHAT_KEYS.messages(sid) });
      await queryClient.invalidateQueries({ queryKey: CHAT_KEYS.sessions });

      if (errored) {
        // Keep the question so the owner can retry; show the sanitized error on a solid surface.
        setStream({ userText: message, assistantText: '', inFlight: false, error: errored });
        setInput(message);
      } else {
        setStream(IDLE);
      }
    } catch {
      // Aborted (stop control) or a network failure before any token — discard the partial,
      // re-enable the input, and preserve the typed question.
      setStream(IDLE);
      setInput(message);
    } finally {
      abortRef.current = null;
    }
  }

  const onInputKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const showEmpty = !sessionId && !stream.userText && (messages.data?.length ?? 0) === 0;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gridTemplateRows: 'minmax(0, 1fr)', gap: 16, height: '100%', minHeight: 0 }}>
      <SessionSidebar activeId={sessionId} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        {/* SOLID message region — every bubble/number sits here, never on glass. */}
        <div
          aria-label="Conversa"
          aria-live="polite"
          style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}
        >
          {showEmpty && <EmptyConversation onExample={(q) => void send(q)} />}

          {messages.data?.map((m) => (
            <ChatBubble key={m.id} from={m.role === 'user' ? 'me' : 'them'}>
              {m.role === 'assistant' ? <Markdown text={m.content} /> : <span className="ds-num">{m.content}</span>}
            </ChatBubble>
          ))}

          {/* Optimistic + streaming overlay (cleared once the canonical query refetches). */}
          {stream.userText && <ChatBubble from="me">{stream.userText}</ChatBubble>}
          {stream.inFlight && (
            <ChatBubble from="them">
              <div aria-busy="true">
                {stream.assistantText ? <Markdown text={stream.assistantText} /> : 'respondendo…'}
              </div>
            </ChatBubble>
          )}
          {stream.error && <ErrorPanel code={stream.error.code} message={stream.error.message} />}
        </div>

        {/* Chrome row: GLASS input + model switcher. Gated behind connection readiness. */}
        {!readiness.isPending && !readiness.ready ? (
          <GatingPanel dbActive={readiness.dbActive} aiActive={readiness.aiActive} />
        ) : (
          <GlassPanel style={{ padding: 12, borderRadius: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ fontSize: 13, color: 'var(--c-text-2)', display: 'flex', gap: 6, alignItems: 'center' }}>
                Modelo
                <select
                  aria-label="Modelo"
                  value={model}
                  onChange={(e) => setModel(e.target.value as ClaudeModelId)}
                  style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--c-border)' }}
                >
                  {CLAUDE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                aria-label="Mensagem"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onInputKey}
                disabled={stream.inFlight}
                rows={2}
                placeholder="Pergunte sobre seus dados…"
                style={{
                  flex: 1,
                  resize: 'none',
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid var(--c-border)',
                  background: 'var(--c-surface)',
                  color: 'var(--c-text)',
                  font: 'inherit',
                }}
              />
              <Button type="button" disabled={stream.inFlight} onClick={() => void send(input)}>
                {stream.inFlight ? 'respondendo…' : 'Enviar'}
              </Button>
            </div>
          </GlassPanel>
        )}

        {messages.isError && (
          <Card role="alert">
            <p style={{ margin: 0, color: 'var(--c-text-2)' }}>Conversa não encontrada.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
