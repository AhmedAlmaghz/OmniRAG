CREATE TABLE "webhook_endpoints" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_delivery_at" varchar(100),
	"last_delivery_status" varchar(20),
	"created_at" varchar(100) NOT NULL,
	"updated_at" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "webhook_endpoints_tenant_id_idx" ON "webhook_endpoints" USING "btree" ("tenant_id");
