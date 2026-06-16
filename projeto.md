# Business Assistant — o projeto e a identidade

Documento de identidade do projeto. Serve pra qualquer pessoa (ou agente) entender
em poucos minutos **o que** estamos construindo, **por que**, e **qual a cara** disso.
A parte tecnica (stack, invariantes, ordem de build) esta no `HANDOFF.md`.

## O que e

Um dashboard onde o dono de um negocio conecta o banco de dados dele e uma IA, e
faz perguntas em linguagem natural que sao respondidas sobre os dados reais e ao
vivo do negocio dele.

Exemplo: a pessoa digita "quanto vendi em maio?" e recebe "R$ 128.000, 12% a mais
que abril", calculado em cima do banco dela na hora.

O diferencial e a camada de IA sobre **dado estruturado** (banco relacional), nao
sobre documentos. O numero sai do banco, entao e exato. E o produto e deliberadamente
generico (qualquer negocio com banco), nao mais um plugin de e-commerce.

## O problema que resolve

O dono do negocio tem os dados, mas a resposta esta presa atras de SQL, planilha ou
de alguem que sabe extrair. Aqui ele pergunta em portugues e recebe a resposta sobre
os proprios dados, sem escrever uma linha de codigo.

## Para quem e

Donos de pequenos e medios negocios que querem respostas dos proprios dados sem
depender de relatorio pronto nem de quem saiba consultar banco.

## Como funciona (resumo)

1. O dono conecta o banco dele (MySQL na v1), com uma credencial **somente leitura**.
   A consulta e sempre **ao vivo**, nunca uma copia.
2. O dono conecta uma IA (Claude na v1), usando a **chave dele** (a conta de IA e
   dele, nao nossa).
3. No chat, ele pergunta. A IA escolhe, de um **cardapio de funcoes de consulta
   pre-definidas**, qual usar (ela nunca escreve SQL livre). O backend roda a query
   real, devolve o resultado pra IA, e a IA redige a resposta com streaming.

## Identidade do produto (valores que guiam tudo)

Isto aqui nao e um brinquedo de IA, e uma ferramenta de negocio. Os valores abaixo
nao sao enfeite: cada um virou decisao de arquitetura.

- **Privacidade e menor privilegio.** Acesso somente leitura, o dono escolhe quais
  tabelas o assistente pode ver, e os segredos ficam criptografados.
- **Precisao.** Quem faz a conta e o banco, nao o modelo. Numero certo, sempre.
- **Seguranca por construcao.** O modelo so tem portas seguras: funcoes pre-definidas
  e parametrizadas. Nao da pra convencer ele a rodar SQL arbitrario porque essa porta
  nao existe.
- **Transparencia.** Fica registrado o que o assistente consultou (auditavel por
  cliente), sem guardar o dado cru.
- **Isolamento.** Cada organizacao so enxerga os proprios dados, forcado na camada
  de dados (toda query escopada por organizacao).

Tom da marca: serio, confiavel e direto.

## Identidade visual

Direcao: **vidro como acento sobre base limpa**. O efeito de vidro fosco
(glassmorphism, no espirito do Liquid Glass da Apple) aparece so na moldura: barra
de cima, menu lateral, campo do chat e menus. O dado (numeros, tabelas, respostas)
vive sempre em superficie solida e de alto contraste.

Regra de ouro: nunca colocar numero ou texto de leitura sobre o vidro. Num produto
de dados, legibilidade ganha de efeito visual.

- **Acento:** azul #185fa5 (transmite confianca).
- **Tema:** claro e escuro, com toggle.
- **Tipografia:** Space Grotesk (titulos e marca) + Inter (corpo e dado).
- **Nome provisorio:** Lumen.
- **Onde esta:** pasta `design-system/` (tokens em `design-system.css`, componentes
  React em `ui.jsx`, guia em `README.md`, e um preview em
  `preview-assistente-vidro.html`).

## Stack (resumo)

React SPA (Vite) no front; backend dedicado em Node/TypeScript; PostgreSQL + Drizzle
no banco da aplicacao; MySQL como banco do cliente na v1 (consultado ao vivo); Claude
via Vercel AI SDK, com a chave do cliente; e-mail transacional (Resend) pra
verificacao. Hospedagem: Cloudflare Pages (front), container Docker num VPS (backend),
Postgres gerenciado (Neon/Supabase). **Detalhes, invariantes e ordem de build no
`HANDOFF.md`.**

## Referencias no Lucid (para o agente acessar)

A fonte da verdade do comportamento esta nestes documentos. Comece pelo primeiro.

- **Arquitetura + Centro de Decisoes** (as 10 decisoes de arquitetura, com os ajustes
  da revisao). Entrada principal:
  https://lucid.app/lucidchart/8e5986dc-834d-4532-b73a-ad35fc210191/edit
- **Fluxo 1 - Cadastro e login:**
  https://lucid.app/lucidchart/fb1ac133-378c-4006-83ff-d5722ca8cd08/edit
- **Fluxo 2 - Conectar o banco do cliente (MySQL):**
  https://lucid.app/lucidchart/4b454d5c-a9a8-4f06-8f1d-e17f125b1042/edit
- **Fluxo 3 - Conectar a IA (Claude):**
  https://lucid.app/lucidchart/e46c90e4-dab4-4724-b73a-55cbc6eb32b8/edit
- **Fluxo 4 - Usar o assistente (pergunta ate resposta):**
  https://lucid.app/lucidchart/f8dacc8a-bc58-414c-803a-e4de3c5ae9f5/edit

(Existe um esboco antigo de arquitetura no Lucid que foi substituido pelo documento
detalhado acima; pode ignorar.)

## Artefatos no repositorio

- `PROJETO.md` (este) — o que e o projeto e a identidade.
- `HANDOFF.md` — stack travada, invariantes inegociaveis e ordem de build em fases.
- `schema.sql` — schema do banco da aplicacao (PostgreSQL), comentado.
- `design-system/` — a identidade visual em codigo (tokens, componentes, preview).
