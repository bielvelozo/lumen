---
tags:
  - handoff
  - qa
created: 2026-09-10
---
# Handoff — continuar testes e correções do Lumen

Este documento é autossuficiente: uma sessão nova consegue subir o ambiente, entender o que já foi feito, o que está aberto e como verificar cada item. Contexto do produto em `AGENTS.md`, `HANDOFF.md` e `projeto.md`. Relatório completo do teste funcional em [[2026-09-05-teste-funcional-cliente]].

## 1. Situação em uma frase

O Lumen é um projeto escolar, sem orçamento para créditos de API. O chat roda pela **assinatura Claude Pro/Max** do dono (`AI_AUTH_MODE=subscription`, Claude Agent SDK). A jornada inteira do cliente foi testada de ponta a ponta; três bugs bloqueantes foram corrigidos e verificados no browser; ficaram abertos um bug de precisão comprovado, o refresh de sessão e um backlog de usabilidade. **Nada foi commitado ainda.**

## 2. Primeiro passo: commitar o que está pendente

`git status` mostra ~28 arquivos. Sugestão de commits separados (todos passam em `pnpm type-check`, `pnpm lint`, `pnpm test`):

1. `feat(ai): subscription mode via Claude Agent SDK` — `apps/api/src/chat/chat-model-agent-sdk.ts` (novo), `chat.service.ts`, `ai-connection.service.ts`, `server.ts`, `packages/shared/src/env.ts`, `ai-contracts.ts`, `apps/web/src/routes/connect-ai/ConnectAiPage.tsx`, `.env.example`, `docker-compose.prod.yml`, `apps/api/package.json`, `pnpm-lock.yaml`.
2. `fix(api,web): body-less POSTs and 4xx pass-through` — `apps/web/src/lib/api-client.ts` (+ test), `apps/api/src/app.ts` (+ test).
3. `fix(api): SSE reply keeps CORS headers and flushes them` — `apps/api/src/chat/chat.route.ts`.
4. `feat(web): render assistant markdown` — `apps/web/src/routes/chat/Markdown.tsx` (novo), `ChatPage.tsx`, `design-system.css`, `apps/web/package.json`.
5. `chore(api): log sanitized provider error on key validation` — `claude-validator.ts`.
6. `docs: QA report, handoff, learnings` — `context/reports/*`, `context/learnings/*`, `context/_index/learnings.md`, `.claude/launch.json`.

## 3. Subir o ambiente

- **Docker Desktop** cai na inicialização depois de uma queda abrupta com `starting services: … listening on unix://…\Docker\run\dockerInference: remove … A sintaxe do nome do arquivo … está incorreta` (ou o mesmo em `docker-secrets-engine\engine.sock`). Contorno que funciona: fechar todos os processos `Docker Desktop`/`com.docker.*`, renomear `%LOCALAPPDATA%\Docker\run` e `%LOCALAPPDATA%\docker-secrets-engine` (os sockets órfãos não são apagáveis), relançar o Docker Desktop, esperar `docker info` responder, `docker compose up -d`. Containers: `lumen-postgres` (5432, postgres/postgres, db `lumen`) e `lumen-mysql` (3306, root/root).
- **API e web** pelo painel de preview do Claude Code (`.claude/launch.json`): `api` roda `pnpm --filter @lumen/api exec tsx src/server.ts` na 3001 (**sem `watch`**: `tsx watch` trava sob o runner do preview desde a instalação do Agent SDK; reinicie o preview da API após editar o backend), `web` roda o Vite na 5173 (HMR normal). Fora do painel: `pnpm --filter @lumen/api dev` e `pnpm --filter @lumen/web dev` em dois terminais funcionam.
- Sinal de vida: `GET http://localhost:3001/health` → `{"status":"ok"}`; o log da API deve mostrar `AI auth: Claude subscription via Agent SDK (default model claude-sonnet-4-6)`.
- Node em uso é 24 (`engines` pede 22); só gera warning.

## 4. Contas e dados de teste (já existem no banco)

| O quê | Valor |
|---|---|
| Cliente de teste | `cliente.teste@example.com` / `Teste!Lumen2026` (org "Distribuidora Teste LTDA", e-mail marcado verificado via SQL) |
| Dono demo do seed | `owner@demo.lumen.local` / `LumenDev!2026` (linhas placeholder não criptografadas em `db_connections`/`ai_connections`, ver P1-2) |
| Conexão MySQL do cliente | host `localhost`, porta 3306, banco `lumen_client`, usuário `lumen_ro` / `RoLumen!2026x`, SSL **desligado** (cert autoassinado), status ativa, tabelas expostas `clientes`, `pedidos`, `itens_pedido`, `produtos` (+ 3 relações); `funcionarios_salarios` propositalmente não exposta |
| Sessões de chat | várias na org do cliente; `baadf3e7-7b24-4452-894e-8cca572cf93a` tem respostas com tabela em markdown |

Valores de referência (MySQL, `pedidos`):

| Medida | Valor |
|---|---|
| Soma `total` maio/2026, todos os status | 117.340,80 |
| Soma `total` maio/2026, `status='pago'` | 89.946,50 |
| Soma `total` abril/2026 | 73.445,90 |
| Pedidos em maio/2026 | 90 (site 38, loja 29, whatsapp 23); ticket médio 1.303,79 |
| Pedidos em maio até `'2026-05-31'` 00:00 (bug P1-10) | 86 (36/27/23); ticket 1.317,78 |
| Top clientes 2026 por `cliente_id` | 2 → 76.998,60; 7 → 72.298,30; 8 → 69.400,60 |

Se precisar recriar o dataset: o script está fora do repo (scratchpad da sessão anterior). Recriar com qualquer seed realista, importando com `mysql --default-character-set=utf8mb4` (sem isso os acentos quebram), e criar o usuário com o script gerado pela própria tela "Banco de dados".

## 5. Modo assinatura — como funciona e limites

- Auth vem do login local do `claude` na máquina (`~/.claude/.credentials.json`); em container/servidor use `CLAUDE_CODE_OAUTH_TOKEN` gerado por `claude setup-token`. Uso pessoal/demo; o modo padrão `api_key` (chave por org) continua existindo.
- Adaptador: `apps/api/src/chat/chat-model-agent-sdk.ts` implementa `ChatModelPort`; as duas funções de consulta viram um servidor MCP em processo (`createSdkMcpServer` + `tool()`), `tools: []` desliga Bash/Read/Write, `allowedTools` = só `mcp__lumen__*`, `settingSources: []`, `cwd` isolado em `%TEMP%\lumen-agent-sdk`, histórico entra como transcrição no prompt, timeout 180 s.
- Latência: 20 s (uma consulta) a ~100 s (duas consultas) por turno. Um turno estourou 180 s uma vez, sem causa identificada (`[agent-sdk] run threw: Claude Code process aborted by user`); a repetição funcionou. Ideia para investigar: `debug`/`debugFile` do SDK, e considerar Haiku 4.5 como padrão para a apresentação.
- Sanidade rápida fora do app: `claude -p "responda apenas: ok" --model claude-sonnet-4-6` deve responder em ~20 s.

## 6. Abertos, em ordem sugerida de ataque

1. **P1-10 precisão na borda do período (comprovado).** `apps/api/src/query-registry/functions/filtered-aggregate.ts`: quando `f.op === 'lte'` e `f.value` casa `^\d{4}-\d{2}-\d{2}$`, vincular `${f.value} 23:59:59` (mesma convenção de `aggregate-over-time.ts`). Teste em `executor.test.ts`/`registry.test.ts`. Verificar: perguntar "quantos pedidos tive por canal em maio de 2026?" → 90 (38/29/23). Opcional: instruir no `system-prompt.ts` a usar limites de dia inteiro e explicar as convenções v1 (filtros só na tabela primária; `groupBy` na tabela juntada quando há `relationship` + `joinTable`) — o modelo tentou um JOIN por nome e falhou com `column_not_exposed` por não conhecer isso.
2. **P0-2 sem refresh de sessão.** `apps/web/src/lib/api-client.ts` e `chat.ts` (`streamMessage`): no 401, chamar `POST /auth/refresh` uma vez (cookie `lumen_refresh`, `Path=/auth`) e repetir; só então limpar a sessão. Verificar: esperar 15 min logado (ou reduzir `ACCESS_TTL_SECONDS` em `server.ts` temporariamente) e continuar usando o chat sem cair no login.
3. **P0-3 recuperação de senha inexistente.** Endpoints `/auth/forgot-password` e `/auth/reset-password` não existem; a UI finge sucesso. Implementar (token hasheado, mesmo padrão de `verification.*`) ou esconder os links em `LoginPage`/rotas.
4. **P0-4 histórico invertido.** `apps/api/src/chat/chat.store.ts` → `recentMessages`: `orderBy(asc)` + `limit(10)` pega as mais antigas; usar `desc` + inverter. Prova: sessão com 24 mensagens não inclui a última pergunta.
5. **P1-1 sessionId não-UUID → 500.** `chat.route.ts`: validar `:sessionId` com `z.string().uuid()` → 404. (O handler agora repassa 4xx, mas o erro `22P02` do Postgres continua sendo 500.)
6. **P1-2 seed com placeholders.** `apps/api/src/db/seed.ts` grava `SEED_PLACEHOLDER_NOT_ENCRYPTED`; o dono demo recebe 500 em re-validar/re-testar. Remover essas linhas do seed ou criptografar com a chave real; e tratar `CryptoError` em `decrypt` como estado `failed`.
7. **P1-3 mutations sem `onError`.** `ConnectAiPage`, `CredentialForm`, `StatusDashboard`, `ChatPage` (catch genérico). Feedback padrão com `x-request-id`.
8. **P1-4 credencial root persistida em `failed`.** `db-connection.service.ts` → `createOrUpdate`: não gravar credencial quando o teste falha antes do `SHOW GRANTS` (ou recusar `root`/`admin` por nome antes).
9. **P1-5 Home com métricas fictícias.** `apps/web/src/routes/HomePage.tsx`: trocar por checklist Banco → IA → Chat com status real (`useConnectionState`, `useAiConnection`).
10. **P1-6 responsivo** (grid fixo 240px, sem `@media`), **P1-7 sidebar** (`NavItem` é `<a href>`: usar `Link`/`NavLink` e passar `active`), **P1-8 429 no login** exibido como senha inválida, **P1-9 sem "revogar conexão"**, **P1-11 pergunta órfã em turno falho**, **P1-12 verificação de e-mail sem Resend** (mailbox local em dev), **P1-13 lista de modelos fixa** (`CLAUDE_MODELS` em `ai-contracts.ts`), **P1-14 validação de chave** (só relevante no modo `api_key`: usar Models API, mapear 400 de workspace/créditos para mensagens claras).
11. **P2** (14 itens): validação Zod em inglês, datas ISO cruas, "Editar credenciais" vazio, cards de erro antigos, mensagem de SSL sem orientação, chat sem auto-scroll/botão parar/indicador de consulta, script de onboarding não idempotente, links de auth sem estilo, sem confirmação ao conectar, auditoria com códigos crus, acessibilidade (checkboxes "on"), tela de IA sem explicar o tipo de chave, cosméticos.
12. **Dev/infra:** Vitest não carrega `.env` (38 testes live pulam; `setupFiles` com dotenv), 500 não logado em dev (`logger: false` + Sentry no-op), `VITE_API_URL` do `.env` raiz ignorado, sem seed do banco do cliente.

## 7. Receitas de verificação

```bash
# login + cookie jar
curl -s -c jar -X POST http://localhost:3001/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"cliente.teste@example.com","password":"Teste!Lumen2026"}'
# estado da IA (modo assinatura)
curl -s -b jar http://localhost:3001/ai-connection
# criar sessão e perguntar (SSE); a resposta demora 20–100 s
SID=$(curl -s -b jar -X POST http://localhost:3001/chat/sessions | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
curl -s -N -m 240 -b jar -X POST http://localhost:3001/chat/sessions/$SID/messages \
  -H 'Content-Type: application/json' -d '{"message":"Quanto vendi em maio de 2026?"}'
# auditoria
curl -s -b jar "http://localhost:3001/audit/function-calls"
```

```sql
-- conferência no MySQL
docker exec lumen-mysql mysql -uroot -proot -e "USE lumen_client; SELECT canal, COUNT(*) FROM pedidos WHERE criado_em >= '2026-05-01' AND criado_em < '2026-06-01' GROUP BY canal;"
```

No browser (painel de preview): o `read_page`/clique por coordenada falha com o painel oculto; o que funciona de forma confiável é `find` → `form_input` por `ref` para inputs, e `javascript_tool` para clicar botões (`[...document.querySelectorAll('button')].find(b => b.textContent.trim()==='Enviar').click()`) e para preencher o textarea do chat (setter nativo de `value` + `dispatchEvent(new Event('input',{bubbles:true}))`).

## 8. Armadilhas conhecidas

- A sessão expira em 15 min (P0-2): faça login de novo antes de testes longos no browser.
- Reinicie o preview da API após editar `apps/api` (sem watch).
- Erros 500 não aparecem em lugar nenhum localmente; o validador de chave e o adaptador do Agent SDK já logam com prefixo `[ai-connection]`/`[agent-sdk]`; siga o mesmo padrão ao investigar outra coisa.
- Testes `*.live.integration.test.ts` só rodam com `DATABASE_URL`/`MYSQL_URL` exportados no shell (o Vitest não lê o `.env`).
- O SDK exige `zod@^4` como peer, mas o projeto usa zod 3; é só warning (o SDK converte o shape internamente). Não atualizar o zod do projeto por causa disso.
- `preview_start` falha se as portas 3001/5173 já estiverem ocupadas por terminais do usuário; nesse caso mude o `launch.json` para anexar por `url` sem comando.

## 9. Materiais

- Relatório completo: [[2026-09-05-teste-funcional-cliente]] (também publicado como artifact: https://claude.ai/code/artifact/249572b0-4dfa-4c43-aa35-fffa48719ed8).
- Learnings desta rodada: [[../learnings/bodyless-post-with-json-content-type-is-rejected]], [[../learnings/hijacked-sse-reply-loses-cors-headers]], [[../learnings/subscription-mode-agent-sdk-instead-of-api-key]], [[../learnings/vitest-does-not-load-root-env-live-tests-skip]].
- Referência de outro projeto que usa o mesmo mecanismo de assinatura: `C:\Users\gabri\development\project-whis\apps\worker\src\agent\backends\claude-code.ts`.
