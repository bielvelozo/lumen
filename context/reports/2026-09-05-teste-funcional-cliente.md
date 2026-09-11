---
tags:
  - report
  - qa
created: 2026-09-05
---
# Teste funcional ponta a ponta — jornada do cliente (2026-09-05)

Simulação de um cliente real usando o Lumen local: cadastro → verificação → login → conectar MySQL (consentimento, script, credenciais, introspecção, exposição) → conectar IA → chat → auditoria. Cobriu UI (Chrome, temas claro/escuro, desktop e mobile), API (curl), banco (Postgres + MySQL Docker) e a camada de funções de consulta direto contra o MySQL. Suíte automatizada: type-check e lint verdes; API 268 testes passando (38 pulados), web 54 passando.

**Bloqueado:** o trecho IA → chat com resposta real não foi executado porque não há chave Anthropic no ambiente (`ANTHROPIC_API_KEY` vazio e nenhuma chave conectada). Ver seção "Pendente".

Ambiente: API já rodando em `:3001` (tsx watch) e web em `:5173` (Vite), Postgres e MySQL nos containers `lumen-postgres` / `lumen-mysql`. Para o teste criei no MySQL um banco "de cliente" realista (`lumen_client`: `clientes`, `produtos`, `pedidos`, `itens_pedido`, `funcionarios_salarios`; 1.046 pedidos de 2025-01 a 2026-09) e o usuário `lumen_ro` usando o script gerado pelo próprio app. Valores de referência: soma de `pedidos.total` em maio/2026 = **117.340,80**; só `status='pago'` = **89.946,50**.

---

## Resumo executivo

| Sev. | Qtd. | Destaques |
|---|---|---|
| P0 — bloqueia o produto | 4 | Todo POST sem corpo do front dá 500 (chat não cria conversa, "Testar novamente" e logout quebrados); sessão morre em 15 min sem refresh; "Esqueci minha senha" finge sucesso sobre um endpoint inexistente; histórico do chat manda as 10 mensagens mais **antigas** ao modelo. |
| P1 — alto impacto | 14 | 4xx virando 500; seed grava blobs não criptografados; formulários sem feedback de erro; credencial root persistida quando o teste falha antes do SHOW GRANTS; métricas fictícias na Home; layout não responsivo; sidebar recarrega a página; 429 exibido como senha inválida; sem "revogar conexão"; prompt sem data atual; lista de modelos Claude fixa e defasada; validação da chave estoura em 10 s e vira "sem rede". |
| P2 — usabilidade/polimento | 14 | Validação em inglês, datas em ISO cru, formulário de edição vazio, sem markdown/scroll no chat, mensagem de SSL sem orientação, links de baixo contraste, acessibilidade. |
| Dev/infra | 6 | Testes "live" pulam mesmo com Docker de pé; 500 não é logado em dev; Node 24 vs engines <23; `VITE_API_URL` do `.env` raiz é ignorado. |

O núcleo de segurança está sólido (ver "O que funcionou"). Os problemas graves estão na integração front↔API e em caminhos de erro.

---

## P0 — Bloqueiam o uso

### P0-1. Todo `POST` sem corpo disparado pelo front retorna 500
- **Onde:** `apps/web/src/lib/api-client.ts` (`apiFetch` sempre envia `Content-Type: application/json`, mesmo sem `body`) + `apps/api/src/app.ts` (`setErrorHandler` converte qualquer erro, inclusive 4xx do Fastify, em `500 InternalError`).
- **Evidência:** `curl -X POST /chat/sessions -H 'Content-Type: application/json'` (sem corpo) → `500`; sem o header → `201`. Mesmo padrão em `/db-connection/test` e `/auth/logout`. No browser: `POST /chat/sessions → 500` (2×), `POST /db-connection/test → 500`, `POST /auth/logout → 500`. Causa: Fastify rejeita corpo JSON vazio (`FST_ERR_CTP_EMPTY_JSON_BODY`, 400), e o handler mascara como 500.
- **Impacto para o cliente:**
  1. **Chat não inicia conversa pela interface.** Clicar num exemplo ou enviar a 1ª mensagem chama `createSession()` → 500 → o `catch` restaura o texto e nada acontece. Mesmo com IA conectada, o chat é inutilizável a partir da UI (só via `/chat/:id` de sessão criada por fora).
  2. **"Testar novamente"** (dashboard e card de falha) não faz nada.
  3. **Logout não revoga o refresh token no servidor.** A UI limpa o estado local, mas o cookie continua válido: `POST /auth/refresh` com o mesmo cookie após "Sair" → `200`. Sessão de 30 dias sobrevive ao logout.
- **Correção sugerida:** em `apiFetch`, só enviar `Content-Type` quando houver `body` (ou enviar `{}`); no `setErrorHandler`, repassar `error.statusCode` quando `< 500` (validação/parsing/413) e só reportar ao Sentry os 5xx. Adicionar um teste de integração web→API real (os testes web mockam `fetch`, por isso não pegaram).

### P0-2. Sessão expira em 15 minutos: o front nunca chama `/auth/refresh`
- **Onde:** `apps/web/src/lib/` — não existe nenhuma chamada a `/auth/refresh` (grep confirma). O access JWT tem `Max-Age=900`.
- **Impacto:** após 15 min, toda chamada devolve 401 → `query-client` zera `me` → redirect para `/login`, mesmo com refresh cookie válido por 30 dias. Um cliente no meio de uma conversa é derrubado a cada 15 min.
- **Correção:** interceptor em `apiFetch`/`streamMessage`: no 401, tentar `POST /auth/refresh` uma vez e repetir a requisição; só então limpar a sessão.

### P0-3. "Esqueci minha senha" / "Redefinir senha" fingem funcionar
- **Onde:** `ForgotPasswordPage` usa `onSettled: () => setSent(true)`; a API não tem `/auth/forgot-password` nem `/auth/reset-password` (ambos `404`, confirmado por curl e pelo browser).
- **Impacto:** o cliente vê "Se existir uma conta com esse e-mail, enviamos um link para redefinir a senha" e nenhum e-mail chega. Quem esquece a senha perde a conta. Está documentado em `DECISIONS.md` como "deferred", mas a UI está exposta ao cliente.
- **Correção:** implementar o backend (token hasheado, mesmo padrão da verificação) ou remover os links até existir.

### P0-4. Histórico do chat manda as mensagens mais ANTIGAS ao modelo
- **Onde:** `apps/api/src/chat/chat.store.ts` → `recentMessages`: `orderBy(asc(createdAt)).limit(10)`.
- **Evidência:** sessão com 24 mensagens → contexto enviado = `pergunta 1 … resposta 5`; `pergunta 12` (a atual) **não está** no contexto.
- **Impacto:** a partir da 6ª pergunta, o modelo nunca recebe a pergunta atual e responde à conversa antiga (ou repete). 
- **Correção:** `orderBy(desc(createdAt)).limit(n)` e inverter em memória.

---

## P1 — Alto impacto

### P1-1. Erros 4xx legítimos viram `500 InternalError` (e vão para o Sentry)
- JSON malformado no body → 500 (deveria 400). Body de 5 MB → 500 (deveria 413). `GET /chat/sessions/not-a-uuid/messages` e `PATCH /chat/sessions/abc` → 500 (erro `22P02` do Postgres ao castar uuid) — deveria ser 404/400.
- **Correção:** validar `:sessionId` com `z.string().uuid()` antes da query; no error handler, respeitar `statusCode` < 500.

### P1-2. Seed de dev grava segredos placeholder não criptografados
- `apps/api/src/db/seed.ts` insere `db_connections` e `ai_connections` com `SEED_PLACEHOLDER_NOT_ENCRYPTED`.
- **Evidência (dono demo `owner@demo.lumen.local`):** `PUT /ai-connection` sem chave (re-validar) → 500; `POST /db-connection/test` → 500. Na UI, "IA (Claude)" mostra "Nova chave da Anthropic (opcional)" e o botão "Validar e salvar"; clicar → 500 e **nenhum feedback**.
- **Correção:** seed sem essas linhas (ou criptografar com `SECRETS_ENCRYPTION_KEY` real), e `decrypt` falhando deve virar estado `failed` + categoria, não exceção.

### P1-3. Ações falham em silêncio (sem `onError`)
- `ConnectAiPage`: mutation sem `onError` → 500/rede = nada na tela.
- `CredentialForm`: trata só 400 e 422; 403 `ConsentRequired`, 500 e falha de rede = nada.
- `StatusDashboard`/`TestResult` retest: sem `onError`.
- `ChatPage`: `catch` genérico descarta o erro e apenas devolve o texto ao campo.
- **Correção:** feedback padrão de erro ("Não foi possível concluir. Tente novamente.") em toda mutation + `x-request-id` para suporte.

### P1-4. Credencial root é persistida quando o teste falha antes do `SHOW GRANTS`
- Fluxo: root + SSL ligado → handshake TLS falha (`ssl_error`) → o serviço **salva** a credencial criptografada com `status=failed`. Confirmado no Postgres: `username=root, status=failed, last_error=ssl_error`.
- Viola o espírito do invariante 5 (nunca guardar root). Só depois, com SSL desligado, o root foi rejeitado (422) corretamente.
- **Correção:** não persistir credencial em `failed`; ou ao menos rejeitar `root`/`admin` por nome antes de conectar.

### P1-5. Home exibe métricas fictícias como se fossem reais
- Cliente recém-cadastrado, sem banco conectado, vê "Vendas em maio R$ 128.000 +12% vs abril", "Pedidos 342", "Ticket médio R$ 374". Num produto cujo valor é "número exato do seu banco", isso destrói confiança.
- **Correção:** substituir por um checklist de onboarding (1 Banco → 2 IA → 3 Chat) com status real de cada passo.

### P1-6. Layout não responsivo
- Grid fixo `240px 1fr` no shell e no chat; nenhuma `@media` no CSS além de `prefers-reduced-motion`. Em 375 px: `scrollWidth` 658 vs `clientWidth` 375 (rolagem horizontal, textos quebrando letra a letra).

### P1-7. Sidebar recarrega a página inteira e não destaca a rota ativa
- `NavItem` renderiza `<a href>` puro (não `Link`), então cada clique é navegação completa (estado JS perdido — verificado com marcador em `window`, sessão refetch, splash). A prop `active` nunca é passada: nenhum item fica em destaque.

### P1-8. Rate limit (429) exibido como "E-mail ou senha inválidos"
- `LoginPage.onError` trata qualquer status ≠ 403 como credencial inválida. Após 10 tentativas o usuário certo vê "senha inválida" por 15 min sem saber que está bloqueado.

### P1-9. Termos prometem "conexão pode ser revogada a qualquer momento", mas não há como revogar
- Não existe botão nem endpoint para desconectar/apagar a credencial do banco nem a chave da IA. Também não há excluir conversa.

### P1-10. Prompt do sistema sem data atual nem semântica das tabelas
- `system-prompt.ts` lista tabelas/colunas, mas não informa a data de hoje. "Quanto vendi em maio?" (exemplo sugerido pela própria UI) é ambíguo (2025? 2026?). Também não há descrição de negócio das colunas (ex.: `status` = pago/pendente/cancelado), então "quanto vendi" pode somar cancelados (117.340,80 vs 89.946,50 pagos).
- Riscos adicionais na camada de consulta (testados direto): `RESULT_ROW_LIMIT=1000` linhas vão inteiras ao modelo (grão diário de 2025 devolveu 532 linhas); em `filtered_aggregate`, `lte '2026-05-31'` em coluna `datetime` exclui o dia 31 (só `aggregate_over_time` acrescenta `23:59:59`); filtros só na tabela primária e `groupBy` só na tabela juntada (limitação v1 documentada, mas o modelo não é avisado disso).

### P1-11. Turno que falha deixa pergunta órfã sem explicação
- Com IA não conectada, `POST .../messages` persiste a mensagem do usuário, cria título e devolve `error`. Reabrir a conversa mostra a pergunta sem resposta e sem qualquer marca do erro. Os botões de exemplo continuam clicáveis com o chat bloqueado (disparam a criação de sessão → hoje 500 pelo P0-1).

### P1-13. Lista de modelos Claude é fixa e já está uma geração atrás (apontado pelo usuário)
- **Onde:** `packages/shared/src/ai-contracts.ts` → `CLAUDE_MODELS` (Opus 4.8, Sonnet 4.6, Haiku 4.5; "verificado em 2026-06-18"). Alimenta o `<select>` da tela de IA, o switcher do chat e a validação do servidor (id fora da lista → 400 antes de chamar a Anthropic).
- **Estado atual da API (referência `claude-api`, cache 2026-06-24):** geração corrente é `claude-opus-5`, `claude-sonnet-5` e `claude-haiku-4-5`; `claude-fable-5-1` é o mais capaz (preço acima do tier Opus). Opus 4.8 e Sonnet 4.6 seguem servidos, então o seletor funciona, mas o padrão do produto está defasado e o cliente não consegue usar um modelo novo mesmo tendo acesso pela própria chave.
- **Correção:** (1) curto prazo, atualizar a lista e `DEFAULT_MODEL` para `claude-opus-5` (e o seed, que grava `claude-opus-4-8`); (2) estrutural, buscar os modelos com a chave do cliente via Models API (`client.models.list()` do SDK) na validação da chave, cachear por org e validar o id submetido contra essa lista, mantendo a curada só como fallback. Conferir que o adaptador de chat não envia `budget_tokens` (400 em Opus 4.7+; thinking adaptativo é o padrão em Opus 5).

### P1-14. Validação da chave estoura em 10 s e o estouro é exibido como "Não foi possível falar com a Anthropic"
- **Onde:** `apps/api/src/ai-connection/claude-validator.ts` → `createAiSdkValidator` faz um `generateText` real no modelo escolhido com `abortSignal: AbortSignal.timeout(10_000)`; `categorizeProviderError` mapeia `TimeoutError` para `network`.
- **Evidência (chave real do usuário, dono demo):** `PUT /ai-connection` respondeu `{ error: "network" }` com a requisição durando ~10 s no painel de rede. No mesmo minuto, uma chave inválida devolveu `invalid_key` em 0,8 s e `fetch` do Node 24 alcançou `api.anthropic.com` em 0,6 s, então não há problema de rede. Uma geração no Opus 4.8, mesmo com `maxOutputTokens: 4`, pode passar de 10 s.
- **Impacto:** cliente com chave válida recebe uma mensagem falsa de indisponibilidade e não consegue conectar a IA; nada é persistido (comportamento correto para falha, mas o motivo está errado).
- **Segunda tentativa do usuário:** resposta rápida com `{ error: "unknown" }`. Pelo mapeamento, é um 4xx fora de 401/403/404/429; o caso típico é `400 invalid_request_error` por saldo de créditos insuficiente na conta Anthropic. A UI mostra apenas "Não foi possível validar a chave", sem caminho de ação, e o erro bruto do provedor não é logado nem em dev, então nem o time consegue diagnosticar pela aplicação. Adicionar categoria `billing`/`bad_request` com texto orientando (ex.: "Sua conta Anthropic parece sem créditos") e logar o erro sanitizado (status + `error.type`, nunca a chave) quando o Sentry está desabilitado.
- **Motivo real (após adicionar log sanitizado no validador, commit local):** `status=400 type=invalid_request_error message="This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header…"`. A chave do usuário é de **organização** (sem workspace); a Anthropic exige o header `anthropic-workspace-id` e o Lumen não o envia em nenhum lugar (validador nem adaptador do chat). Solução para o cliente: gerar uma chave vinculada a um workspace no console. Solução no produto: campo opcional "ID do workspace" na tela de IA, persistido junto da conexão, e header via `createAnthropic({ apiKey, headers: { 'anthropic-workspace-id': id } })` no validador e no chat; no mínimo, mapear esse 400 para uma mensagem que explique como gerar a chave certa.
- **Correção:** validar a chave sem gerar texto, com a Models API (`client.models.list()` do SDK), que responde em menos de 1 s, não gasta tokens e ainda devolve a lista de modelos que a chave pode usar (resolve também o P1-13). Se mantiver a geração de teste, subir o timeout para 30 s, usar Haiku 4.5 para o ping e separar `timeout` de `network` na categoria e no texto exibido.

### P1-12. Verificação de e-mail depende de Resend; sem ele o cadastro é um beco sem saída
- Sem `RESEND_API_KEY`, o e-mail é "skipped" e o link (token cru) não é logado por design. Localmente, um cadastro novo nunca consegue logar (403) — precisei fazer `UPDATE users SET email_verified=true`. Em produção exige Resend configurado e domínio verificado (o sender padrão é o sandbox `onboarding@resend.dev`).
- **Sugestão:** em `NODE_ENV=development`, um "mailbox" local (logar o link ou gravar em arquivo) e/ou um endpoint dev para pegar o token.

---

## P2 — Usabilidade e polimento

1. **Validação em inglês** numa UI pt-BR: "Organization name is required", "A valid email is required", "Password must be at least 8 characters", "Password is too common…", "Message is required", "Invalid enum value…". Mensagens vêm dos schemas Zod compartilhados.
2. **Datas em ISO cru**: "testado em 2026-09-05T00:15:53.622Z" (dashboard) e coluna "Quando" da Auditoria. Formatar em pt-BR e fuso local.
3. **"Editar credenciais" abre vazio**: host/porta/banco/usuário não são pré-preenchidos; o cliente redigita tudo.
4. **Cards de erro antigos ficam na tela**: após o `ssl_error`, ao tentar de novo com root o card "Erro de SSL/TLS" permaneceu junto do novo aviso de credencial privilegiada.
5. **Mensagem de SSL não orienta**: "Erro de SSL/TLS na conexão." Certificado autoassinado (padrão em MySQL local/hospedagens) falha com `rejectUnauthorized: true` e não há opção "TLS sem verificar certificado". O texto deveria sugerir o caminho.
6. **Chat sem renderização de markdown**: respostas do Claude com `**negrito**`, listas e quebras de linha virarão texto cru (`.bubble` sem `white-space: pre-wrap`).
7. **Chat sem auto-scroll**, sem botão "Parar" (o `AbortController` existe mas nenhum controle o aciona), sem indicador de "consultando seus dados…" durante tool calls, e a resposta em streaming aparece antes de qualquer sinal de que uma consulta rodou.
8. **Script de onboarding**: não idempotente (`CREATE USER` sem `IF NOT EXISTS` — rodar duas vezes dá `ERROR 1396`), e o texto está sem acentos ("usuario", "criptografada") enquanto o resto do produto é acentuado.
9. **Links de autenticação** ("Esqueci minha senha · Criar conta", "Voltar para o login") em azul padrão do navegador, baixo contraste no tema escuro — o design system não estiliza `a`.
10. **Sem confirmação de sucesso** ao conectar o banco: salta direto para "3. Tabelas" sem um "Conexão ativa".
11. **Auditoria**: `Motivo` mostra códigos crus (`table_not_exposed`, `invalid_params`); a API aceita filtro por função mas a UI não oferece; sem indicação da conversa de origem.
12. **Acessibilidade**: checkboxes de consentimento/tabelas/relações expostos com nome "on" (label não associada via `htmlFor`/`aria-label`); vários botões "ver colunas" idênticos; menu da conta sem `aria-controls`.
13. **Tela de IA não explica que tipo de chave serve.** Só diz "cole sua chave da Anthropic". Na prática o cliente precisa de uma chave da API criada no console (console.anthropic.com), vinculada a um workspace, em uma conta com créditos de API pré-pagos; a assinatura do Claude.ai (Pro/Max) não dá acesso à API. O usuário do teste passou pelos três tropeços em sequência (chave de organização sem workspace → 400; conta sem créditos → 400; expectativa de usar a assinatura). Acrescentar um texto curto com o passo a passo e um link para o console, e mapear os dois 400 para mensagens específicas (ver P1-14).
14. **Cosmético**: após logout explícito a URL fica `/login?from=%2F`; o card "Bem-vindo" cita o e-mail mas não o nome da empresa; avatar com iniciais do e-mail ("CL", "OW").

---

## Dev / infra

1. **Testes "live" pulam mesmo com Docker de pé**: `pnpm test` → 10 arquivos / 38 testes skipped porque o Vitest não carrega o `.env` raiz (`MYSQL_URL`/`DATABASE_URL` indefinidos no processo). A cobertura DB-facing só roda se alguém exportar as variáveis à mão — e no CI também pula. Sugestão: `setupFiles` com `dotenv` ou documentar `pnpm test` com env carregado.
2. **500 não é logado em dev**: `Fastify({ logger: false })` + handler que só chama `Sentry.captureException` (no-op sem DSN). Um 500 local é invisível — só o `requestId` chega ao cliente. Logar `error` no console quando Sentry está desabilitado.
3. **Node 24 em uso vs `engines: >=22 <23` e `.nvmrc 22.16.0`**: pnpm avisa "Unsupported engine" a cada comando. Alinhar ou relaxar.
4. **`VITE_API_URL` no `.env` raiz é ignorado**: o Vite lê `.env` de `apps/web` (envDir). Funciona por causa do fallback hardcoded `http://localhost:3001`; a variável no `.env.example` raiz é enganosa.
5. **Sem seed do banco "do cliente"**: `lumen_client` estava vazio e sem usuário read-only; não há script/documentação para preparar o cenário de teste local (criei um em `scratchpad`, fora do repo).
6. **`.claude/launch.json`** foi criado por mim para anexar o browser aos servidores já rodando (`api` → :3001, `web` → :5173). Manter ou remover conforme preferir.

---

## O que funcionou (verificado)

- **Isolamento multi-tenant**: sessão de outra org → 404 em GET/PATCH/POST; `org_id` smuggled no body → 400 (`Unrecognized key`); exposição do dono demo não vaza para o cliente.
- **Cookies**: `lumen_access` (15 min, `Path=/`) e `lumen_refresh` (30 d, `Path=/auth`) com `HttpOnly; Secure; SameSite=None`; logout via curl limpa ambos.
- **Refresh**: rotação atômica; reuso de token antigo → 401 e revogação de toda a família (o novo também morre). Access JWT continua válido até expirar (esperado).
- **Rate limit** de login: 11ª tentativa → 429. Denylist de senhas comuns ok. Resposta uniforme em signup duplicado e no reenvio de verificação (anti-enumeração).
- **CORS**: origem fora da lista não recebe `Access-Control-Allow-Origin`; origem permitida recebe com `credentials: true`.
- **Fluxo do banco**: consentimento versionado → script gerado é least-privilege por construção (`USAGE` + `SELECT` no banco) → root rejeitado (422) → conexão read-only ativa em ~0,24 s → introspecção correta (5 tabelas, 3 FKs; composite/views não expostos) → exposição valida nomes (tabela desconhecida, relação com ponta não exposta, nome com `; DROP` → 422) e salva o snapshot.
- **Registro de funções de consulta** (direto, sem IA): `aggregate_over_time` maio/2026 = **117340.80** ✔; `filtered_aggregate` pagos = **89946.50** ✔; JOIN via relação exposta ✔ (soma por cliente, quantidade por categoria); recusas corretas para tabela não exposta, `SUM` sobre `varchar` (`type_mismatch`) e coluna injetada (`column_not_exposed`). Latência 10–120 ms.
- **IA**: modelo fora da lista curada → 400 antes de chamar o provedor; chave inválida → "A chave foi rejeitada pela Anthropic" (categoria `invalid_key`), nada persistido.
- **Tema claro/escuro** persiste e pré-pinta sem flash; vidro só na moldura, dados em superfícies sólidas.

---

## Atualização 2026-09-09 — IA + chat executados em "modo assinatura"

O projeto é escolar e sem orçamento para créditos de API, então foi adicionado um modo alternativo: `AI_AUTH_MODE=subscription` roda o chat pelo **Claude Agent SDK** sob o login Claude Pro/Max de quem opera o servidor (login local do `claude`, ou `CLAUDE_CODE_OAUTH_TOKEN` gerado por `claude setup-token` para containers). Uso pessoal/demo; o modo padrão continua sendo chave de API por org. Arquivos: `apps/api/src/chat/chat-model-agent-sdk.ts` (adaptador do `ChatModelPort`; expõe as duas funções de consulta como ferramentas MCP em processo, `tools: []` desliga Bash/Read/Write, `allowedTools` só as duas, `settingSources: []` e `cwd` isolado), `ai-connection.service.ts` (estado fixo "active" + `mode: 'subscription'`), `chat.service.ts` (não carrega chave por org nesse modo), `server.ts`, `env.ts`, `ConnectAiPage`.

Resultado (Sonnet 4.6, sessão criada via API por causa do P0-1):

| Pergunta | Resposta | Referência MySQL | Tempo |
|---|---|---|---|
| "Quanto vendi em maio de 2026?" | R$ 117.340,80 | 117.340,80 ✔ | 21,8 s |
| "E em abril? Foi maior ou menor?" (histórico) | R$ 73.445,90, +59,8% | 73.445,90 ✔ | — |
| "Qual o salário da Ana Souza?" | recusou: tabela não exposta ✔ | — | — |
| "Quais clientes mais compraram este ano?" | ranking por `cliente_id` (2, 7, 8…) ✔; tentou JOIN e falhou com `column_not_exposed`, depois contornou | IDs e totais ✔ | — |

Auditoria registrou 4 chamadas (3 sucesso, 1 falha `column_not_exposed`) só com tipos nos params. Observações novas: (1) a resposta chega em markdown (tabelas, negrito, emoji) e a UI mostra tudo cru — reforça o P2-6; (2) o modelo não conhece as convenções v1 das funções (filtros só na tabela primária, `groupBy` na tabela juntada), por isso o JOIN falhou — reforça o P1-10: descrever as convenções na descrição das ferramentas; (3) latência de ~20 s por pergunta porque cada turno sobe um subprocesso do Claude Code.

## Atualização 2026-09-10 — correções aplicadas e um bug de precisão comprovado

**Corrigido**
- **P0-1** — `apiFetch` só envia `Content-Type: application/json` quando há corpo; o error handler da API repassa os 4xx do próprio Fastify (`400 BadRequest` para JSON vazio/malformado, 413 etc.) e reserva o `500 InternalError` + Sentry para falhas reais. Verificado: conversa criada pela interface, "Testar novamente" → 200, logout → 200 e o refresh seguinte → 401 (sessão revogada de verdade). Testes novos em `app.test.ts` e `api-client.test.ts`.
- **Novo, encontrado ao testar o stream no browser:** a rota SSE faz `reply.hijack()` e escrevia `writeHead` sem os cabeçalhos CORS que o plugin já tinha posto na `reply`; além disso o Node só enviava os cabeçalhos junto com o primeiro delta (20 s+ depois). O browser recebia `net::ERR_FAILED` e o chat nunca mostrava resposta, embora o backend respondesse e persistisse. Corrigido copiando `access-control-allow-origin`/`-credentials`/`vary` para o `writeHead` e chamando `flushHeaders()`. Os testes de rota usam `app.inject` sem CORS, por isso nunca pegaram.
- **P2-6** — respostas do assistente renderizadas como markdown (`react-markdown` + `remark-gfm`; tabelas, listas, negrito, código) em `Markdown.tsx`, com CSS `.md` dentro da bolha. Verificado no browser com tabela "Canal | Pedidos".

**Comprovado (ainda aberto) — precisão na borda do período (P1-10)**
- Pergunta: "Quantos pedidos tive por canal em maio de 2026?". O modelo chamou `filtered_aggregate` com `criado_em gte '2026-05-01'` e `lte '2026-05-31'`. Em coluna `DATETIME`, `<= '2026-05-31'` significa meia-noite do dia 31, então os 4 pedidos daquele dia ficaram de fora.
- Resposta do Lumen: **86** pedidos (site 36, loja 27, WhatsApp 23), ticket médio **R$ 1.317,78**. MySQL: **90** pedidos (site 38, loja 29, WhatsApp 23), ticket **R$ 1.303,79**. Para um produto cuja promessa é "o número exato", isso é um defeito central.
- Correção sugerida (backend, determinística): em `filtered_aggregate`, quando `op = lte` e o valor casa com `YYYY-MM-DD`, vincular `valor + ' 23:59:59'` (mesma convenção que `aggregate_over_time` já usa); opcionalmente instruir o modelo no prompt a usar limites de dia inteiro. Uma linha no builder + um teste.

**Observações**
- Cada turno leva 20 s a 100 s no modo assinatura (subprocesso do Claude Code por pergunta; duas consultas ≈ 100 s). Um turno estourou o timeout de 180 s uma vez, sem causa identificada; a repetição funcionou.
- O P0-2 (sem refresh de sessão) continua: a sessão expirou no meio do teste e derrubou o usuário para o login.

## Roteiro original (executado acima)

Para reproduzir com chave de API em vez da assinatura:
1. Na tela **IA (Claude)** do cliente `cliente.teste@example.com` (senha `Teste!Lumen2026`), cole a chave e clique "Conectar e validar" (não digito credenciais em formulários; a chave só existe criptografada no Postgres).
2. Como o P0-1 impede criar conversa pela UI, uso uma sessão criada via API e abro `/chat/<id>` para enviar as perguntas de referência:
   - "Quanto vendi em maio?" → esperado 117.340,80 (ou 89.946,50 se o modelo filtrar pagos — observar se ele pergunta/explicita).
   - "Quantos pedidos tive no último mês?" → depende da data atual (o prompt não a informa; ver P1-10).
   - "Qual meu ticket médio?", "Vendas por cliente", "Salário da Ana" (deve recusar: tabela não exposta).
3. Verificar Auditoria (linhas por tool call, params só com tipos), streaming, títulos de sessão e comportamento com chave revogada (`ai_key_invalid`).

---

## Apêndice — reproduções rápidas

```bash
# P0-1: POST sem corpo com Content-Type JSON
curl -s -b jar -X POST http://localhost:3001/chat/sessions -H 'Content-Type: application/json'   # 500
curl -s -b jar -X POST http://localhost:3001/chat/sessions                                        # 201
```

```bash
# P1-1: sessionId não-UUID
curl -s -b jar http://localhost:3001/chat/sessions/not-a-uuid/messages   # 500 (esperado 404)
```

```bash
# P0-3: endpoints de senha inexistentes
curl -s -X POST http://localhost:3001/auth/forgot-password -H 'Content-Type: application/json' -d '{"email":"x@y.z"}'   # 404
```

Dados de teste deixados no ambiente: org "Distribuidora Teste LTDA" (`cliente.teste@example.com`, e-mail marcado como verificado via SQL), conexão ativa `lumen_ro`@`lumen_client`, 2 sessões de chat vazias; MySQL `lumen_client` com o dataset e o usuário `lumen_ro` (senha `RoLumen!2026x`, apenas SELECT).
