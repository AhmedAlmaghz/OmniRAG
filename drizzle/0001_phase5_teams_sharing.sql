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
CREATE TABLE "teams" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"created_at" varchar(100) NOT NULL
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
CREATE TABLE "sso_flows" (
	"state" varchar(100) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"code_verifier" varchar(200) NOT NULL,
	"redirect_uri" text NOT NULL,
	"expires_at" varchar(100) NOT NULL,
	"created_at" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_tenant_idx" ON "memberships" ("user_id","tenant_id");
--> statement-breakpoint
CREATE INDEX "memberships_tenant_id_idx" ON "memberships" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_idx" ON "invitations" ("token");
--> statement-breakpoint
CREATE INDEX "invitations_tenant_id_idx" ON "invitations" ("tenant_id");
--> statement-breakpoint
CREATE INDEX "teams_tenant_id_idx" ON "teams" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_user_idx" ON "team_members" ("team_id","user_id");
--> statement-breakpoint
CREATE INDEX "team_members_user_id_idx" ON "team_members" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "resource_shares_grant_idx" ON "resource_shares" ("resource_type","resource_id","grantee_type","grantee_id");
--> statement-breakpoint
CREATE INDEX "resource_shares_tenant_id_idx" ON "resource_shares" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "resource_shares_link_token_idx" ON "resource_shares" ("link_token") WHERE link_token IS NOT NULL;
