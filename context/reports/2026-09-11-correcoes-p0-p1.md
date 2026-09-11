---
tags:
  - handoff
  - qa
created: 2026-09-11
---
# Correções P0/P1 e novo estado — 11/09/2026

Sucede [[2026-09-10-handoff-testes-e-correcoes]], que continua valendo para **ambiente, contas e dados de teste** (seções 3, 4, 5, 7 e 8 de lá). Este documento registra o que foi corrigido nesta rodada, como cada item foi provado, e o que sobrou.

## 1. Situação em uma frase

O trabalho pendente da rodada anterior foi commitado em 6 commits; os cinco itens da fila de ataque (P1-10, P0-2, P0-3, P0-4, P1-1) foram corrigidos, mais o P1-2 e o item de dev/infra dos testes; tudo verificado contra o ambiente real (Postgres + MySQL em Docker, navegador, modo assinatura); um bug novo apareceu durante a verificação e foi corrigido. **`pnpm test` agora soma 477 testes: 475 verdes e 2 pulados** (os dois que gastariam créditos da API).

## 2. O que foi corrigido

| Item | O quê | Como foi provado |
|---|---|---|
| **P1-10** | `filtered_aggregate` vinculava `lte '2026-05-31'` como meia-noite e perdia o último dia (maio dava 86 em vez de 90). Agora uma data pura no `lte` vira `23:59:59`, mesma convenção do `aggregate_over_time`. O system prompt passou a declarar as convenções v1 e a **listar os relacionamentos expostos** — o modelo não tinha como saber que existiam. | Teste unitário + caso live contra o MySQL do Docker (linha às 23:30 do último dia tem de entrar, 00:30 do mês seguinte não) + perguntas reais no chat: **38 site / 29 loja / 23 whatsapp / 90 total** e **ticket médio R$ 1.303,79**, idênticos ao `SELECT` direto e aos números de referência do handoff anterior. |
| **P0-2** | Nada renovava o access token de 15 min: o dono caía no login no meio da conversa. `apiFetch` troca o cookie de refresh por um novo access e repete a requisição uma vez; `streamMessage` faz o mesmo na mão. Single-flight, porque `/auth/refresh` **rotaciona** o token. | No navegador com `ACCESS_TTL_SECONDS` temporariamente em 15 s: `/auth/me` 401 → `/auth/refresh` 200 → `/auth/me` 200 → app segue logado. 4 testes novos no `api-client`, 2 no `chat`. |
| **P0-3** | Recuperação de senha existia só na UI. Implementado o backend inteiro: tabela `password_reset_tokens` (migration 0004), token só em hash, consumo single-use numa UPDATE condicional, reemissão invalida o link anterior. `forgot-password` responde igual para e-mail conhecido e desconhecido e é rate-limited; `reset-password` usa a mesma política de senha do signup e devolve 400 para link inutilizável. Link vive **1 hora** e consumi-lo **revoga todos os refresh tokens** do usuário. | Fluxo completo pela UI e por curl: token válido → 200; replay → 400; senha antiga → 401; senha nova → 200; refresh anterior → 401. 6 testes de store contra o Postgres real, 6 de serviço, 5 de rota. |
| **P0-4** | `recentMessages` ordenava `asc` e depois `LIMIT 10`, entregando ao modelo as dez conversas **mais antigas** — a pergunta recém-feita ficava de fora. Agora a janela sai do fim. | Suite live nova do `chat.store`: com 14 turnos e janela de 10, tem de voltar 5..14. Revertendo a correção o teste falha com 1..10 (a forma exata do bug). |
| **P1-1** | `:sessionId` fora do formato UUID chegava ao Postgres e virava 500 (erro 22P02). Agora é 404, antes de tocar o banco, nas três rotas. | `curl` nas três rotas → 404, 404, 404. Teste de rota confirma que nenhum store é chamado. |
| **P1-2** | O seed gravava `SEED_PLACEHOLDER_NOT_ENCRYPTED` em `db_connections`/`ai_connections` e o dono demo levava 500 ao revalidar. O seed agora cria só org + dono. Além disso, os **três** pontos que descriptografam segredo tratam `CryptoError` como conexão inutilizável: IA vira `failed`/`invalid_key`, banco vira `failed`/`auth_failed` (sem nem discar), e um turno de chat responde `ai_key_invalid`. | Testes nos três serviços; a mesma falha estava a uma rotação de chave de acontecer em produção. |
| **dev/infra** | Vitest não lia o `.env` da raiz, então toda suite `skipIf(!DATABASE_URL)` pulava mesmo com Docker no ar (44 pulados). `setupFiles` carrega o `.env` sem sobrescrever export real. Vite tinha o espelho do problema: `envDir` agora aponta para a raiz, então `VITE_API_URL` deixa de ser ignorado. | `pnpm test` sem exportar nada: **API 340 verdes, 2 pulados** (antes 286 verdes e 44 pulados). |
| **novo** | Achado na verificação: o Agent SDK terminou um turno com `subtype: 'success'` cujo texto inteiro era `Usage credits are required for long context requests.` — foi transmitido ao dono e **persistido como resposta do assistente**, envenenando o histórico do turno seguinte. Um segundo caso apareceu em seguida (`Prompt is too long`, com Haiku 4.5). Agora um resultado curto que abre com um aviso conhecido do CLI vira erro (`rate_limited` para a família de cota, `unknown` para o resto), mostra a mensagem em pt-BR do próprio app e **não grava nada**. | Os dois reproduzidos ao vivo; a pergunta de cota acertou na repetição. Predicado coberto por teste. |

## 3. Commits

```
2dce7c6 fix(ai): a Claude Code status line is not an answer
a9b57a8 test(api): cover the two precision bugs against the real databases
6f5238b test(api,web): load the root .env so the DB-facing suites actually run
d61c5fb fix(api): an unreadable stored secret is a failed connection, not a 500
d3472fb feat(auth): password recovery (forgot-password + reset-password)
3c99918 fix(api): keep the LAST turns in the model's context, and 404 a non-UUID sessionId
221054d fix(web): renew the access token on a 401 instead of dropping the session
39287e7 fix(registry): a bare ISO date under `lte` covers the whole last day
```
antes deles, os 6 commits que organizaram o trabalho pendente da rodada anterior (`dd4d6db`..`62fe101`): modo assinatura, POST sem corpo + 4xx, CORS no SSE, markdown no chat, log sanitizado do validador, docs.

## 4. O que continua aberto

Na ordem sugerida de ataque:

1. **P1-3 mutations sem `onError`** — `ConnectAiPage`, `CredentialForm`, `StatusDashboard`, `ChatPage` (catch genérico). Feedback padrão com `x-request-id`.
2. **P1-4 credencial root persistida em `failed`** — `db-connection.service.ts` → `createOrUpdate`: não gravar credencial quando o teste falha antes do `SHOW GRANTS`, ou recusar `root`/`admin` pelo nome antes.
3. **P1-5 Home com métricas fictícias** — `HomePage.tsx` mostra "R$ 128.000 / 342 pedidos / R$ 374" chumbados na tela inicial de um produto cujo diferencial é número exato. Trocar por um checklist Banco → IA → Chat com status real.
4. **P1-6** responsivo (grid fixo 240px, sem `@media`), **P1-7** sidebar (`NavItem` é `<a href>`: usar `Link`/`NavLink`), **P1-8** 429 no login exibido como senha inválida, **P1-9** sem "revogar conexão", **P1-11** pergunta órfã em turno falho, **P1-12** verificação de e-mail sem Resend (mailbox local em dev), **P1-13** lista de modelos fixa, **P1-14** validação de chave (só no modo `api_key`).
5. **P2** (14 itens de usabilidade) — ver seção 6 do handoff anterior.
6. **Dev/infra restante:** 500 não logado em dev (`logger: false` + Sentry no-op); sem seed do banco do cliente.

Observações que valem para a apresentação:

- **Haiku 4.5 não funciona neste setup.** O seletor de modelo funciona — o override chega ao SDK (verificado: um turno rodou como `claude-haiku-4-5` e outro como `claude-opus-4-8`) — mas o turno em Haiku voltou com `Prompt is too long`. A ideia de usar Haiku na apresentação para ganhar latência está **bloqueada** enquanto o prompt que o Agent SDK monta não for enxugado. Opus 4.8 e Sonnet 4.6 respondem normalmente.
- **Corrida no seletor de modelo:** o `ChatPage` inicia o switcher no padrão curado (Opus 4.8) e só troca para o padrão da org quando o `useChatReadiness` resolve. Quem enviar a primeira pergunta rápido demais manda Opus sem ter escolhido. Item pequeno, mas some com um `disabled` enquanto `readiness.isPending`.
- Latência do turno segue em 20–100 s (uma a duas consultas), com Sonnet 4.6.
- O e-mail de verificação e o de redefinição só saem com `RESEND_API_KEY`; sem ela o `consoleEmailSender` registra apenas o destinatário (nunca o link). Ou seja: **não dá para completar a redefinição pela UI em dev** sem pegar o token no banco. Para a demo, ou configura o Resend, ou mostra o fluxo com um token inserido à mão.

## 5. Detalhes que mudaram o ambiente

- Migration **0004** (`password_reset_tokens`) já aplicada no Postgres local; `db/schema.sql` acompanhado.
- O **seed não cria mais** as linhas de `db_connections`/`ai_connections`. As linhas placeholder antigas que já existiam no banco local continuam lá — agora elas produzem estado `failed` em vez de 500.
- Senha do cliente de teste **inalterada** (`Teste!Lumen2026`): ela foi trocada e restaurada durante a verificação do reset.
- Docker Desktop travou de novo no mesmo modo descrito no handoff anterior; o contorno (matar os processos, renomear `%LOCALAPPDATA%\Docker\run` e `%LOCALAPPDATA%\docker-secrets-engine`, relançar) funcionou. As pastas viraram `*.broken-20260911-202211` e podem ser apagadas.

## 6. Learnings desta rodada

- [[../learnings/bare-iso-date-as-inclusive-upper-bound-drops-the-last-day]]
- [[../learnings/claude-code-status-line-arrives-as-a-successful-answer]]
- [[../learnings/refresh-on-401-must-be-single-flight-because-rotation]]
- [[../learnings/vitest-does-not-load-root-env-live-tests-skip]] (atualizado: resolvido)
