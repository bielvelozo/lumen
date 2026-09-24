import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CLAUDE_MODELS, DEFAULT_MODEL, type ClaudeModelId, type ChatErrorCode } from '@lumen/shared';
import { GlassPanel, Card, ChatBubble, LogoMark } from '../../design-system/ui';
import { LockIcon, SendIcon } from '../../design-system/icons';
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
 * A question handed over from the home page (`location.state.ask`) is sent once on arrival.
 */
export function ChatPage(): JSX.Element {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const readiness = useChatReadiness();
  const messages = useMessages(sessionId);

  const [input, setInput] = useState('');
  const [stream, setStream] = useState<StreamState>(IDLE);
  const [model, setModel] = useState<ClaudeModelId>(DEFAULT_MODEL);
  const [modelInit, setModelInit] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const handedOffRef = useRef(false);

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

  const handedOff = (location.state as { ask?: unknown } | null)?.ask;
  useEffect(() => {
    if (typeof handedOff !== 'string' || handedOffRef.current || readiness.isPending || !readiness.ready) return;
    handedOffRef.current = true;
    navigate(location.pathname, { replace: true, state: null });
    void send(handedOff);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per handed-off question
  }, [handedOff, readiness.isPending, readiness.ready]);

  const onInputKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const showEmpty = !sessionId && !stream.userText && (messages.data?.length ?? 0) === 0;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '280px minmax(0, 1fr)',
        gridTemplateRows: 'minmax(0, 1fr)',
        gap: 24,
        height: 'calc(100dvh - 80px)',
        minHeight: 0,
      }}
    >
      <SessionSidebar activeId={sessionId} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        {/* SOLID message region — every bubble/number sits here, never on glass. */}
        <div aria-label="Conversa" aria-live="polite" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 22, paddingBottom: 8 }}>
            {showEmpty && <EmptyConversation onExample={(q) => void send(q)} />}

            {messages.data?.map((m) =>
              m.role === 'assistant' ? (
                <AssistantMessage key={m.id}>
                  <Markdown text={m.content} />
                </AssistantMessage>
              ) : (
                <ChatBubble key={m.id} from="me">
                  <span className="ds-num">{m.content}</span>
                </ChatBubble>
              ),
            )}

            {/* Optimistic + streaming overlay (cleared once the canonical query refetches). */}
            {stream.userText && <ChatBubble from="me">{stream.userText}</ChatBubble>}
            {stream.inFlight && (
              <AssistantMessage>
                <div aria-busy="true">
                  {stream.assistantText ? (
                    <Markdown text={stream.assistantText} />
                  ) : (
                    <span style={{ color: 'var(--c-text-3)' }}>respondendo…</span>
                  )}
                </div>
              </AssistantMessage>
            )}
            {stream.error && <ErrorPanel code={stream.error.code} message={stream.error.message} />}

            {messages.isError && (
              <Card role="alert">
                <p style={{ margin: 0, color: 'var(--c-text-2)' }}>Conversa não encontrada.</p>
              </Card>
            )}
          </div>
        </div>

        {/* Chrome row: GLASS input + model switcher. Gated behind connection readiness. */}
        <div style={{ width: '100%', maxWidth: 760, margin: '0 auto' }}>
          {!readiness.isPending && !readiness.ready ? (
            <GatingPanel dbActive={readiness.dbActive} aiActive={readiness.aiActive} />
          ) : (
            <GlassPanel style={{ padding: '14px 16px 12px', borderRadius: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <textarea
                aria-label="Mensagem"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onInputKey}
                disabled={stream.inFlight}
                rows={2}
                placeholder="Pergunte sobre seus dados…"
                style={{
                  resize: 'none',
                  padding: '2px 4px',
                  border: 0,
                  outline: 'none',
                  background: 'transparent',
                  color: 'var(--c-text)',
                  font: 'inherit',
                  fontSize: 15.5,
                  lineHeight: 1.5,
                }}
              />
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <select
                  aria-label="Modelo"
                  className="input"
                  value={model}
                  onChange={(e) => setModel(e.target.value as ClaudeModelId)}
                >
                  {CLAUDE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <span
                  className="ds-mono"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--c-text-3)' }}
                >
                  <LockIcon size={13} />
                  Somente leitura
                </span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  className="btn btn--primary btn--icon"
                  aria-label="Enviar"
                  disabled={stream.inFlight}
                  onClick={() => void send(input)}
                  style={{ width: 40, height: 40, minHeight: 40 }}
                >
                  <SendIcon />
                </button>
              </div>
            </GlassPanel>
          )}
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="msg">
      <LogoMark size={32} tile />
      <div className="msg__body">
        <span className="msg__name">Lumen</span>
        <ChatBubble from="them">{children}</ChatBubble>
      </div>
    </div>
  );
}
