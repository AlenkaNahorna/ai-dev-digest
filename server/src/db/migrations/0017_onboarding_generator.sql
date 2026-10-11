CREATE TABLE "onboarding_generation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"requested_by" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"identity_key" text NOT NULL,
	"attempt_token" uuid,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"error_category" text,
	"tour_id" uuid,
	"model" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_usd" numeric(12, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "onboarding_repo_state" (
	"repo_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"latest_tour_id" uuid,
	"current_request_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"tour_id" uuid,
	"created_by" uuid NOT NULL,
	"token_digest" text NOT NULL,
	"content" jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"repo_full_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "onboarding_tour_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"content" jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"source_sha" text NOT NULL,
	"indexed_at" timestamp with time zone NOT NULL,
	"indexer_version" integer NOT NULL,
	"index_status" text NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_generation_requests" ADD CONSTRAINT "onboarding_generation_requests_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_generation_requests" ADD CONSTRAINT "onboarding_generation_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_generation_requests" ADD CONSTRAINT "onboarding_generation_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_generation_requests" ADD CONSTRAINT "onboarding_requests_tour_fk" FOREIGN KEY ("tour_id") REFERENCES "public"."onboarding_tour_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_repo_state" ADD CONSTRAINT "onboarding_repo_state_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_repo_state" ADD CONSTRAINT "onboarding_repo_state_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_repo_state" ADD CONSTRAINT "onboarding_state_latest_tour_fk" FOREIGN KEY ("latest_tour_id") REFERENCES "public"."onboarding_tour_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_repo_state" ADD CONSTRAINT "onboarding_state_current_request_fk" FOREIGN KEY ("current_request_id") REFERENCES "public"."onboarding_generation_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_shares" ADD CONSTRAINT "onboarding_shares_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_shares" ADD CONSTRAINT "onboarding_shares_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_shares" ADD CONSTRAINT "onboarding_shares_tour_id_onboarding_tour_versions_id_fk" FOREIGN KEY ("tour_id") REFERENCES "public"."onboarding_tour_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_shares" ADD CONSTRAINT "onboarding_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tour_versions" ADD CONSTRAINT "onboarding_tour_versions_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tour_versions" ADD CONSTRAINT "onboarding_tour_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "onboarding_generation_requests_repo_created_idx" ON "onboarding_generation_requests" USING btree ("repo_id","created_at");--> statement-breakpoint
CREATE INDEX "onboarding_generation_requests_ws_idx" ON "onboarding_generation_requests" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "onboarding_generation_requests_active_idx" ON "onboarding_generation_requests" USING btree ("status","lease_expires_at") WHERE "onboarding_generation_requests"."status" in ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_generation_requests_auto_identity_uq" ON "onboarding_generation_requests" USING btree ("repo_id","identity_key") WHERE "onboarding_generation_requests"."trigger" = 'automatic';--> statement-breakpoint
CREATE INDEX "onboarding_generation_requests_tour_idx" ON "onboarding_generation_requests" USING btree ("tour_id");--> statement-breakpoint
CREATE INDEX "onboarding_repo_state_ws_idx" ON "onboarding_repo_state" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "onboarding_repo_state_latest_idx" ON "onboarding_repo_state" USING btree ("latest_tour_id");--> statement-breakpoint
CREATE INDEX "onboarding_repo_state_current_idx" ON "onboarding_repo_state" USING btree ("current_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_shares_token_digest_uq" ON "onboarding_shares" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "onboarding_shares_repo_idx" ON "onboarding_shares" USING btree ("repo_id","created_at");--> statement-breakpoint
CREATE INDEX "onboarding_shares_ws_idx" ON "onboarding_shares" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "onboarding_shares_tour_idx" ON "onboarding_shares" USING btree ("tour_id");--> statement-breakpoint
CREATE INDEX "onboarding_shares_creator_idx" ON "onboarding_shares" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "onboarding_tour_versions_repo_created_idx" ON "onboarding_tour_versions" USING btree ("repo_id","created_at");--> statement-breakpoint
CREATE INDEX "onboarding_tour_versions_ws_idx" ON "onboarding_tour_versions" USING btree ("workspace_id");
