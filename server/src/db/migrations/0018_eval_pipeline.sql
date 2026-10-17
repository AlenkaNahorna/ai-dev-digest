ALTER TABLE "eval_cases" ADD COLUMN "source_finding_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "created_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "agent_version" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "model" text;--> statement-breakpoint
CREATE INDEX "eval_cases_owner_idx" ON "eval_cases" USING btree ("owner_kind","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_cases_owner_finding_uq" ON "eval_cases" USING btree ("owner_id","source_finding_id");--> statement-breakpoint
CREATE INDEX "eval_runs_batch_idx" ON "eval_runs" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "eval_runs_case_idx" ON "eval_runs" USING btree ("case_id","ran_at");
