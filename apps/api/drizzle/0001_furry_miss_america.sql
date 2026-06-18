CREATE TABLE "db_connection_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"consent_version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "db_connection_consents_org_id_consent_version_key" UNIQUE("org_id","consent_version")
);
--> statement-breakpoint
ALTER TABLE "db_connection_consents" ADD CONSTRAINT "db_connection_consents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_connection_consents" ADD CONSTRAINT "db_connection_consents_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dbconn_consent_org" ON "db_connection_consents" USING btree ("org_id");