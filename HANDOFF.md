# Business Assistant - Handoff (v1)

Contexto pro agente que vai construir. Este documento resume as decisoes que
foram tomadas no planejamento. A fonte da verdade do COMPORTAMENTO sao os
diagramas no Lucid (links no fim). Aqui esta o "porque" condensado.

## O que e o produto

Um dashboard onde o dono de um negocio conecta o banco de dados dele e uma IA,
e faz perguntas em linguagem natural que sao respondidas sobre os dados reais
do negocio dele. O diferencial e a camada de IA sobre dado estruturado.
Alem de responder, o assistente propoe ideias de marketing, vendas e gestao
embasadas nos numeros que ele consultou (parte central do produto, nao extra).

## Stack travada (v1)

- Front: React SPA com Vite. React Router + TanStack Query. Design system
  proprio (ver pasta design-system). Sem Next (app atras de login, SSR nao
  aproveitado). Hospedagem: Cloudflare Pages.
- Back: servico Node/TypeScript dedicado (NestJS ou Fastify). Vercel AI SDK
  pra falar com o modelo. Auth por JWT em cookie httpOnly/Secure/SameSite=None.
  Hospedagem: container Docker num VPS pequeno (mata cold start, mostra Docker).
- Banco da aplicacao: PostgreSQL (Neon ou Supabase, gerenciado) + Drizzle ORM.
  Schema completo em schema.sql.
- Banco DO CLIENTE (v1): MySQL, externo, consultado AO VIVO e read-only. Nunca
  copiado, sem cache na v1.
- IA (v1): Claude, via AI SDK. A chave e do cliente (BYO key), usada server-side.
- E-mail transacional: Resend (ou similar com tier gratis) pra verificacao de
  e-mail e recuperacao de senha.
- Observabilidade: Sentry pra erros + log de function calls (sanitizado).

## Invariantes (NAO violar)

1. Isolamento multi-tenant: toda query e escopada por org_id. O org_id vem do
   JWT, nunca de um id mandado pelo cliente (anti-IDOR). O schema carrega org_id
   ate em messages e logs de proposito, pra facilitar esse escopo.
2. Segredos: a senha do banco do cliente e a chave da IA ficam criptografadas em
   repouso (colunas bytea). A chave que descriptografa mora FORA do banco
   (env/secrets manager). O Postgres nunca ve o segredo em texto.
3. O modelo NUNCA emite SQL livre. Ele so escolhe entre funcoes pre-definidas,
   parametrizadas, read-only, que rodam apenas sobre as tabelas que o dono
   expos. Quem executa o SQL e o backend, nao o modelo.
4. Tokens (verificacao de e-mail, refresh) sao guardados como HASH, nunca crus.
5. Credencial do banco do cliente e sempre read-only, criada pelo proprio
   cliente via script de onboarding. Nunca pedir nem guardar o usuario root.
6. Design: o efeito de vidro (glass) so na moldura (sidebar, topbar, campo do
   chat, menus). Dado (numeros, tabelas, respostas) sempre em superficie solida
   de alto contraste.

## Ordem de build sugerida (fases ponta a ponta)

1. Base e auth: Postgres + Drizzle + migrate do schema. Cadastro, login,
   verificacao de e-mail (Resend), JWT em cookie. Shell do front com o design
   system e o toggle de tema.
2. Conectar banco do cliente (MySQL): termos/consentimento, script do usuario
   read-only, coleta, teste de conexao, criptografia, introspeccao, escolha das
   tabelas expostas. Estados de conexao (pending/active/failed + last_error).
3. Conectar IA (Claude): colar token, validar com chamada de teste, criptografar,
   definir modelo padrao.
4. Chat (o coracao): orquestrador com o AI SDK + 1 ou 2 funcoes de consulta
   parametrizadas + streaming + salvar mensagens + logar function calls. Tratar
   os caminhos infelizes (fora de escopo, query vazia, banco caiu, chave falhou).
5. Observabilidade (Sentry), polimento e deploy (Pages + container/VPS +
   Neon/Supabase).
   Cada fase entrega algo que funciona de ponta a ponta, nao um pedaco solto.

## Onde esta cada coisa

- schema.sql ............... schema do banco da aplicacao (PostgreSQL), comentado.
- design-system/ .......... tokens (design-system.css), componentes React (ui.jsx),
  guia (README.md) e um preview (preview-assistente-vidro.html).

## Lucid (comportamento, decisoes e fluxos)

- Business Assistant - Documento mestre:
  https://lucid.app/lucidchart/2e24d5d9-a10e-49a9-a7eb-a975a00e8eca/edit
- Arquitetura + Centro de Decisoes (10 decisoes + ajustes):
  https://lucid.app/lucidchart/8e5986dc-834d-4532-b73a-ad35fc210191/edit
- Fluxo 1 - Cadastro e login:
  https://lucid.app/lucidchart/fb1ac133-378c-4006-83ff-d5722ca8cd08/edit
- Fluxo 2 - Conectar o banco do cliente (MySQL):
  https://lucid.app/lucidchart/4b454d5c-a9a8-4f06-8f1d-e17f125b1042/edit
- Fluxo 3 - Conectar a IA (Claude):
  https://lucid.app/lucidchart/e46c90e4-dab4-4724-b73a-55cbc6eb32b8/edit
- Fluxo 4 - Usar o assistente (pergunta ate resposta): link no historico do chat.

Esses docs serao consolidados num unico Lucid assim que o conector for
reautorizado (a escrita estava bloqueada por permissao no momento da entrega).
