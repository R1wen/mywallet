ALTER TABLE "budgets" ADD COLUMN "alert_percent" integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_target_key" UNIQUE NULLS NOT DISTINCT("user_id","match_type","pattern","merchant_id");--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_alert_check" CHECK ("budgets"."alert_percent" between 1 and 100);