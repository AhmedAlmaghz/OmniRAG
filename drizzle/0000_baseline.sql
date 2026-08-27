CREATE TABLE "api_keys" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"prefix" varchar(30) NOT NULL,
	"key_hash" varchar(100) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb,
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
CREATE TABLE "users" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"created_at" varchar(100) NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
