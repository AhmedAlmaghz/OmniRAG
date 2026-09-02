CREATE TABLE "api_keys" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"prefix" varchar(30) NOT NULL,
	"key_hash" varchar(100) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb,
	"rate_limit_per_minute" integer,
	"mcp_tools" jsonb,
	"expires_at" varchar(100),
	"last_used_at" varchar(100),
	"revoked_at" varchar(100),
	"created_at" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"actor_id" varchar(100) NOT NULL,
	"action" text NOT NULL,
	"resource_type" varchar(100) NOT NULL,
	"resource_id" varchar(100) NOT NULL,
	"status" varchar(50) NOT NULL,
	"details" text,
	"timestamp" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"document_id" varchar(100) NOT NULL,
	"document_title" text DEFAULT '' NOT NULL,
	"content" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"page_number" integer DEFAULT 1,
	"language" varchar(10) NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"document_count" integer DEFAULT 0,
	"created_at" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"title" text NOT NULL,
	"mode" varchar(50) NOT NULL,
	"model" varchar(100) NOT NULL,
	"collection_ids" jsonb DEFAULT '[]'::jsonb,
	"enabled_mcp_servers" jsonb DEFAULT '[]'::jsonb,
	"created_at" varchar(100) NOT NULL,
	"updated_at" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"source_type" varchar(50) DEFAULT 'file' NOT NULL,
	"language" varchar(10) NOT NULL,
	"status" varchar(50) NOT NULL,
	"chunk_count" integer DEFAULT 0,
	"created_at" varchar(100) NOT NULL,
	"metadata" jsonb,
	"collection_ids" jsonb
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(20) DEFAULT 'viewer' NOT NULL,
	"token" varchar(100) NOT NULL,
	"invited_by" varchar(100) NOT NULL,
	"expires_at" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"endpoint_url" text NOT NULL,
	"protocol_version" varchar(50) NOT NULL,
	"sandbox_tier" varchar(50) NOT NULL,
	"enabled_tools" jsonb DEFAULT '[]'::jsonb,
	"require_confirmation_tools" jsonb DEFAULT '[]'::jsonb,
	"status" varchar(50) NOT NULL,
	"latency_ms" integer DEFAULT 0,
	"last_checked" varchar(100) NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb,
	"category" varchar(100),
	"url" text,
	"auth_type" varchar(50),
	"transport_type" varchar(50),
	"config" jsonb DEFAULT '{}'::jsonb,
	"custom_tool_schemas" jsonb DEFAULT '{}'::jsonb,
	"created_at" varchar(100) DEFAULT ''
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"role" varchar(20) DEFAULT 'viewer' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"invited_by" varchar(100),
	"created_at" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"conversation_id" varchar(100) NOT NULL,
	"role" varchar(50) NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb,
	"model_used" varchar(100),
	"tokens_used" jsonb DEFAULT '{}'::jsonb,
	"feedback" varchar(50),
	"tool_calls" jsonb DEFAULT '[]'::jsonb,
	"has_pii_redacted" boolean DEFAULT false,
	"created_at" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_credentials" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"provider_id" varchar(100) NOT NULL,
	"credentials" jsonb DEFAULT '{}'::jsonb,
	"base_url" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" varchar(100) NOT NULL,
	"updated_at" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_windows" (
	"bucket_id" varchar(300) PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"window_start" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_shares" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"resource_type" varchar(50) NOT NULL,
	"resource_id" varchar(100) NOT NULL,
	"grantee_type" varchar(20) NOT NULL,
	"grantee_id" varchar(100) NOT NULL,
	"permission" varchar(20) DEFAULT 'read' NOT NULL,
	"link_token" varchar(100),
	"shared_by" varchar(100) NOT NULL,
	"expires_at" varchar(100),
	"created_at" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schema_meta" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" varchar(200) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token" varchar(100) PRIMARY KEY NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"expires_at" varchar(100) NOT NULL,
	"created_at" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"name" text NOT NULL,
	"type" varchar(50) NOT NULL,
	"status" varchar(50) NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"sync_schedule" varchar(100),
	"last_sync_at" varchar(100),
	"document_count" integer DEFAULT 0,
	"last_error" text,
	"created_at" varchar(100) NOT NULL,
	"collection_ids" jsonb DEFAULT '[]'::jsonb
);
--> statement-breakpoint
CREATE TABLE "sso_flows" (
	"state" varchar(100) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"code_verifier" varchar(200) NOT NULL,
	"redirect_uri" text NOT NULL,
	"expires_at" varchar(100) NOT NULL,
	"created_at" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_logs" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"source_id" varchar(100) NOT NULL,
	"source_name" text NOT NULL,
	"status" varchar(50) NOT NULL,
	"items_processed" integer DEFAULT 0,
	"duration_ms" integer DEFAULT 0,
	"message" text,
	"timestamp" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"team_id" varchar(100) NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"added_by" varchar(100),
	"created_at" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"created_at" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"plan" varchar(50) DEFAULT 'starter' NOT NULL,
	"created_at" varchar(100) NOT NULL,
	"settings" jsonb
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"conversation_id" varchar(100),
	"scoped_tool_name" text NOT NULL,
	"input_params" jsonb DEFAULT '{}'::jsonb,
	"output_result" jsonb DEFAULT '{}'::jsonb,
	"latency_ms" integer DEFAULT 0,
	"status" varchar(50) NOT NULL,
	"has_side_effect" boolean DEFAULT false,
	"user_confirmed" boolean DEFAULT false,
	"timestamp" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"tenant_id" varchar(100) NOT NULL,
	"period" varchar(7) NOT NULL,
	"tokens_used" bigint DEFAULT 0 NOT NULL,
	"updated_at" varchar(100) NOT NULL,
	CONSTRAINT "usage_counters_tenant_id_period_pk" PRIMARY KEY("tenant_id","period")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"created_at" varchar(100) NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
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
CREATE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_tenant_id_idx" ON "api_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "chunks_tenant_id_idx" ON "chunks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "chunks_document_id_idx" ON "chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "chunks_tenant_document_idx" ON "chunks" USING btree ("tenant_id","document_id");--> statement-breakpoint
CREATE INDEX "chunks_fts_english_gin" ON "chunks" USING gin (to_tsvector('english'::regconfig, content));--> statement-breakpoint
CREATE INDEX "chunks_fts_arabic_gin" ON "chunks" USING gin (to_tsvector('arabic'::regconfig, content));--> statement-breakpoint
CREATE INDEX "documents_tenant_id_idx" ON "documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_idx" ON "invitations" USING btree ("token");--> statement-breakpoint
CREATE INDEX "invitations_tenant_id_idx" ON "invitations" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_tenant_idx" ON "memberships" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE INDEX "memberships_tenant_id_idx" ON "memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "messages_tenant_conversation_idx" ON "messages" USING btree ("tenant_id","conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_credentials_tenant_provider_idx" ON "provider_credentials" USING btree ("tenant_id","provider_id");--> statement-breakpoint
CREATE INDEX "rate_limit_windows_window_start_idx" ON "rate_limit_windows" USING btree ("window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_shares_grant_idx" ON "resource_shares" USING btree ("resource_type","resource_id","grantee_type","grantee_id");--> statement-breakpoint
CREATE INDEX "resource_shares_tenant_id_idx" ON "resource_shares" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_shares_link_token_idx" ON "resource_shares" USING btree ("link_token") WHERE link_token IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_user_idx" ON "team_members" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX "team_members_user_id_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "teams_tenant_id_idx" ON "teams" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_tenant_id_idx" ON "webhook_endpoints" USING btree ("tenant_id");