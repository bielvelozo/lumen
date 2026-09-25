CREATE TABLE "sales_mappings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"amount_column" text NOT NULL,
	"date_column" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_mappings" ADD CONSTRAINT "sales_mappings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;