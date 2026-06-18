CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('pending', 'active', 'failed');--> statement-breakpoint
CREATE TYPE "public"."log_status" AS ENUM('success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TABLE "ai_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" text DEFAULT 'claude' NOT NULL,
	"encrypted_api_key" "bytea" NOT NULL,
	"default_model" text,
	"status" "connection_status" DEFAULT 'pending' NOT NULL,
	"last_validated_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "db_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"engine" text DEFAULT 'mysql' NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"database_name" text NOT NULL,
	"username" text NOT NULL,
	"ssl_enabled" boolean DEFAULT true NOT NULL,
	"encrypted_password" "bytea" NOT NULL,
	"status" "connection_status" DEFAULT 'pending' NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_error" text,
	"consent_version" text NOT NULL,
	"consent_accepted_at" timestamp with time zone NOT NULL,
	"consent_accepted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exposed_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"db_connection_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"relationship_name" text NOT NULL,
	"from_table" text NOT NULL,
	"from_column" text NOT NULL,
	"to_table" text NOT NULL,
	"to_column" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exposed_relationships_db_connection_id_relationship_name_key" UNIQUE("db_connection_id","relationship_name")
);
--> statement-breakpoint
CREATE TABLE "exposed_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"db_connection_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exposed_tables_db_connection_id_table_name_key" UNIQUE("db_connection_id","table_name")
);
--> statement-breakpoint
CREATE TABLE "function_call_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"session_id" uuid,
	"message_id" uuid,
	"function_name" text NOT NULL,
	"params" jsonb,
	"status" "log_status" NOT NULL,
	"duration_ms" integer,
	"provider" text,
	"model" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'owner' NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "ai_connections" ADD CONSTRAINT "ai_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_connections" ADD CONSTRAINT "db_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_connections" ADD CONSTRAINT "db_connections_consent_accepted_by_users_id_fk" FOREIGN KEY ("consent_accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exposed_relationships" ADD CONSTRAINT "exposed_relationships_db_connection_id_db_connections_id_fk" FOREIGN KEY ("db_connection_id") REFERENCES "public"."db_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exposed_relationships" ADD CONSTRAINT "exposed_relationships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exposed_tables" ADD CONSTRAINT "exposed_tables_db_connection_id_db_connections_id_fk" FOREIGN KEY ("db_connection_id") REFERENCES "public"."db_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exposed_tables" ADD CONSTRAINT "exposed_tables_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "function_call_logs" ADD CONSTRAINT "function_call_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "function_call_logs" ADD CONSTRAINT "function_call_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "function_call_logs" ADD CONSTRAINT "function_call_logs_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "function_call_logs" ADD CONSTRAINT "function_call_logs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_aiconn_org" ON "ai_connections" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_session_org" ON "chat_sessions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_session_org_updated" ON "chat_sessions" USING btree ("org_id","updated_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "idx_dbconn_org" ON "db_connections" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_evt_token" ON "email_verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_evt_user" ON "email_verification_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_exposed_rel_org" ON "exposed_relationships" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_exposed_rel_conn" ON "exposed_relationships" USING btree ("db_connection_id");--> statement-breakpoint
CREATE INDEX "idx_exposed_org" ON "exposed_tables" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_log_org_created" ON "function_call_logs" USING btree ("org_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "idx_msg_session" ON "messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_msg_org" ON "messages" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_rt_token" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_rt_user" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_users_org" ON "users" USING btree ("org_id");