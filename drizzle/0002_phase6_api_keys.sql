ALTER TABLE "api_keys" ADD COLUMN "rate_limit_per_minute" integer;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "mcp_tools" jsonb;
