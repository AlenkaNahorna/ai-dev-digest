ALTER TABLE "ci_installations" ADD COLUMN "workflow_version" integer;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "post_as" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "triggers" jsonb;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "pr_url" text;--> statement-breakpoint
-- Installations created by the v1 export carry the fixed v1 workflow: reflect that
-- so the CI tab can flag them as out of date instead of showing "version unknown".
UPDATE "ci_installations" SET "workflow_version" = 1, "post_as" = 'github_review', "triggers" = '["opened","synchronize","reopened"]'::jsonb WHERE "workflow_version" IS NULL;
