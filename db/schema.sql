-- =============================================================================
-- Assistente de IA  -  Schema do banco da APLICACAO (PostgreSQL)
-- =============================================================================
-- Este e o banco da aplicacao (Decisao 4), NAO o banco do cliente.
-- O banco do cliente (MySQL na v1) e externo e so e consultado ao vivo;
-- aqui a gente guarda so a CONFIG e a CREDENCIAL (criptografada) dele.
--
-- Principios de design embutidos:
--  1. Isolamento por tenant (Decisao 7): org_id viaja em TODA tabela de dados,
--     inclusive messages e logs (desnormalizado de proposito). Assim toda query
--     pode filtrar direto por org_id, sem depender de lembrar de um JOIN.
--     E a defesa em profundidade contra IDOR.
--  2. Segredos (Decisao 1 e 4): senha do banco do cliente e chave da IA ficam
--     como blob CRIPTOGRAFADO (bytea). A chave de criptografia mora FORA do
--     banco (env / secrets manager). O Postgres nunca ve o segredo em texto.
--  3. Tokens descartaveis (verificacao de e-mail, refresh) sao guardados como
--     HASH, igual senha. O valor cru so existe no e-mail / no cookie.
--  4. Estados de conexao viram coluna (status + last_error), que foi o que os
--     fluxos 2 e 3 revelaram.
--
-- Obs: gen_random_uuid() e nativo no PostgreSQL 13+. Em versoes mais antigas,
-- habilite a extensao pgcrypto.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
CREATE TYPE user_role          AS ENUM ('owner', 'member');          -- 'member' so na v2 (convites)
CREATE TYPE connection_status  AS ENUM ('pending', 'active', 'failed');
CREATE TYPE message_role       AS ENUM ('user', 'assistant');
CREATE TYPE log_status         AS ENUM ('success', 'failed');


-- ----------------------------------------------------------------------------
-- organizations  (o tenant; criada no cadastro, fluxo 1)
-- ----------------------------------------------------------------------------
CREATE TABLE organizations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
-- O dono nao e uma coluna aqui (evita FK circular com users); o dono e o
-- usuario com role = 'owner' dentro da org. Na v1 ha exatamente um.


-- ----------------------------------------------------------------------------
-- users  (fluxo 1)
-- ----------------------------------------------------------------------------
CREATE TABLE users (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email          text NOT NULL UNIQUE,          -- unico global (1 pessoa = 1 conta na v1)
    password_hash  text NOT NULL,                 -- bcrypt/argon2, nunca a senha crua
    role           user_role NOT NULL DEFAULT 'owner',
    email_verified boolean NOT NULL DEFAULT false,
    verified_at    timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_org ON users(org_id);


-- ----------------------------------------------------------------------------
-- email_verification_tokens  (verificacao de e-mail, fluxo 1)
-- ----------------------------------------------------------------------------
CREATE TABLE email_verification_tokens (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  text NOT NULL,            -- HASH do token; o valor cru so vai no link do e-mail
    expires_at  timestamptz NOT NULL,     -- token expira
    used_at     timestamptz,             -- single-use: setado quando consumido
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_evt_token ON email_verification_tokens(token_hash);
CREATE INDEX idx_evt_user  ON email_verification_tokens(user_id);


-- ----------------------------------------------------------------------------
-- refresh_tokens  (sessao / refresh do JWT, Decisao 7)
-- ----------------------------------------------------------------------------
CREATE TABLE refresh_tokens (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  text NOT NULL,            -- HASH; o valor cru vive no cookie httpOnly
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,             -- para rotacao / logout
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rt_token ON refresh_tokens(token_hash);
CREATE INDEX idx_rt_user  ON refresh_tokens(user_id);


-- ----------------------------------------------------------------------------
-- password_reset_tokens  (recuperacao de senha, fluxo 1)
-- ----------------------------------------------------------------------------
CREATE TABLE password_reset_tokens (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  text NOT NULL,            -- HASH do token; o valor cru so vai no link do e-mail
    expires_at  timestamptz NOT NULL,     -- vida curta (1h): o link entrega a conta
    used_at     timestamptz,             -- single-use: setado quando consumido
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_prt_token ON password_reset_tokens(token_hash);
CREATE INDEX idx_prt_user  ON password_reset_tokens(user_id);


-- ----------------------------------------------------------------------------
-- db_connections  (conexao com o banco DO CLIENTE, fluxo 2; MySQL na v1)
-- ----------------------------------------------------------------------------
CREATE TABLE db_connections (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- config NAO-secreta
    engine              text NOT NULL DEFAULT 'mysql',   -- v1 so 'mysql'
    host                text NOT NULL,
    port                integer NOT NULL,
    database_name       text NOT NULL,
    username            text NOT NULL,                   -- o usuario read-only (nao e segredo)
    ssl_enabled         boolean NOT NULL DEFAULT true,

    -- segredo (criptografado em repouso; chave fora do banco)
    encrypted_password  bytea NOT NULL,

    -- estado da conexao (revelado pelo fluxo 2)
    status              connection_status NOT NULL DEFAULT 'pending',
    last_tested_at      timestamptz,
    last_error          text,                            -- sanitizado, sem dado cru

    -- consentimento dos termos (fluxo 2)
    consent_version     text NOT NULL,
    consent_accepted_at timestamptz NOT NULL,
    consent_accepted_by uuid REFERENCES users(id),

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dbconn_org ON db_connections(org_id);
-- v1: uma conexao de cliente por org — CRAVADO (spec 08, migration 0002).
CREATE UNIQUE INDEX uq_dbconn_org ON db_connections(org_id);


-- ----------------------------------------------------------------------------
-- exposed_tables  (quais tabelas o dono liberou pro assistente ver, fluxo 2)
-- ----------------------------------------------------------------------------
-- Menor privilegio no nivel do dado: o assistente so enxerga o que esta aqui.
-- 'columns' guarda o resultado da introspeccao (nome + tipo de cada coluna).
CREATE TABLE exposed_tables (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    db_connection_id  uuid NOT NULL REFERENCES db_connections(id) ON DELETE CASCADE,
    org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,  -- desnormalizado p/ isolamento
    table_name        text NOT NULL,
    columns           jsonb NOT NULL DEFAULT '[]',   -- ex: [{"name":"total","type":"decimal"}, ...]
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (db_connection_id, table_name)
);
CREATE INDEX idx_exposed_org ON exposed_tables(org_id);


-- ----------------------------------------------------------------------------
-- exposed_relationships  (quais relacionamentos/FKs o dono liberou, fluxo 2)
-- ----------------------------------------------------------------------------
-- Mesma ideia de menor privilegio da exposed_tables, agora para JOINs. Cada
-- linha e uma foreign key descoberta na introspeccao e APROVADA pelo dono. O
-- assistente so pode juntar tabelas por um relacionamento que esteja aqui,
-- nunca um JOIN arbitrario (e o que mantem o join dentro da allow-list).
-- 'relationship_name' e o identificador que o modelo referencia no cardapio.
-- Invariante (validada na aplicacao): from_table e to_table precisam estar
-- ambas em exposed_tables da MESMA conexao antes de ativar o relacionamento.
CREATE TABLE exposed_relationships (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    db_connection_id   uuid NOT NULL REFERENCES db_connections(id) ON DELETE CASCADE,
    org_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,  -- desnormalizado p/ isolamento
    relationship_name  text NOT NULL,        -- nome que o modelo usa, ex: 'orders_products'
    from_table         text NOT NULL,        -- lado que segura a FK (filho)
    from_column        text NOT NULL,
    to_table           text NOT NULL,        -- lado referenciado (pai)
    to_column          text NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (db_connection_id, relationship_name)
);
CREATE INDEX idx_exposed_rel_org  ON exposed_relationships(org_id);
CREATE INDEX idx_exposed_rel_conn ON exposed_relationships(db_connection_id);


-- ----------------------------------------------------------------------------
-- ai_connections  (conexao com a IA, fluxo 3; Claude na v1)
-- ----------------------------------------------------------------------------
CREATE TABLE ai_connections (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider           text NOT NULL DEFAULT 'claude',   -- v1 so 'claude'
    encrypted_api_key  bytea NOT NULL,                   -- segredo, criptografado em repouso
    default_model      text,                             -- modelo padrao (trocavel no chat)
    status             connection_status NOT NULL DEFAULT 'pending',
    last_validated_at  timestamptz,
    last_error         text,                             -- sanitizado
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_aiconn_org ON ai_connections(org_id);
-- v1: um provedor por org — CRAVADO (spec 11, migration 0003). Single-column por org
-- para o upsert por org (ON CONFLICT) e para bloquear uma segunda linha.
CREATE UNIQUE INDEX uq_aiconn_org ON ai_connections(org_id);


-- ----------------------------------------------------------------------------
-- chat_sessions  (Decisao 4)
-- ----------------------------------------------------------------------------
CREATE TABLE chat_sessions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_session_org         ON chat_sessions(org_id);
CREATE INDEX idx_session_org_updated ON chat_sessions(org_id, updated_at DESC);


-- ----------------------------------------------------------------------------
-- messages  (fluxo 4)
-- ----------------------------------------------------------------------------
-- ATENCAO: o conteudo das respostas pode conter dado de negocio do cliente,
-- entao vale a mesma regra de isolamento (org_id viaja junto).
CREATE TABLE messages (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,  -- desnormalizado p/ isolamento
    role        message_role NOT NULL,
    content     text NOT NULL,
    model       text,                         -- qual modelo respondeu (null em mensagem do user)
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_msg_session ON messages(session_id, created_at);
CREATE INDEX idx_msg_org     ON messages(org_id);


-- ----------------------------------------------------------------------------
-- function_call_logs  (observabilidade, Decisao 10 + fluxo 4)
-- ----------------------------------------------------------------------------
-- Log do que o assistente fez. SEM dado cru: 'params' e 'error_message' sao
-- sanitizados. Serve pra debug e pra auditoria por org.
CREATE TABLE function_call_logs (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
    session_id     uuid REFERENCES chat_sessions(id) ON DELETE SET NULL,
    message_id     uuid REFERENCES messages(id) ON DELETE SET NULL,
    function_name  text NOT NULL,
    params         jsonb,            -- sanitizado (nomes/sinais, nao valores sensiveis)
    status         log_status NOT NULL,
    duration_ms    integer,          -- latencia da chamada (Decisao 10)
    provider       text,
    model          text,
    error_message  text,             -- sanitizado
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_log_org_created ON function_call_logs(org_id, created_at DESC);


-- =============================================================================
-- Fora do escopo da v1 (anotado pra nao esquecer):
--  - Convite de mais usuarios por org / membership (role 'member').
--  - Mais de um provedor de IA e mais de um banco de cliente por org.
--  - Exposicao no nivel de COLUNA (hoje e no nivel de tabela + introspeccao).
--  - updated_at e mantido pela aplicacao/ORM (ou via trigger), nao incluido aqui.
-- =============================================================================