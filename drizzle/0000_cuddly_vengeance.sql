CREATE TABLE "auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'checking' NOT NULL,
	"institution" text,
	"opening_balance_cents" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "accounts_type_check" CHECK ("accounts"."type" in ('checking', 'savings', 'cash', 'credit_card', 'other')),
	CONSTRAINT "accounts_name_check" CHECK (btrim("accounts"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"icon" text,
	"color" text,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "categories_user_id_parent_id_name_key" UNIQUE NULLS NOT DISTINCT("user_id","parent_id","name"),
	CONSTRAINT "categories_kind_check" CHECK ("categories"."kind" in ('expense', 'income', 'transfer')),
	CONSTRAINT "categories_parent_check" CHECK ("categories"."parent_id" is distinct from "categories"."id"),
	CONSTRAINT "categories_name_check" CHECK (btrim("categories"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "categorization_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"match_type" text NOT NULL,
	"pattern" text,
	"merchant_id" uuid,
	"category_id" uuid NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categorization_rules_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "categorization_rules_match_type_check" CHECK ("categorization_rules"."match_type" in ('contains', 'equals', 'starts_with', 'merchant')),
	CONSTRAINT "categorization_rules_target_check" CHECK (("categorization_rules"."match_type" = 'merchant' and "categorization_rules"."merchant_id" is not null and "categorization_rules"."pattern" is null)
        or ("categorization_rules"."match_type" <> 'merchant' and "categorization_rules"."merchant_id" is null and btrim(coalesce("categorization_rules"."pattern", '')) <> ''))
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"domain" text,
	"logo_url" text,
	"logo_source" text,
	"default_category_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchants_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "merchants_user_id_normalized_name_key" UNIQUE("user_id","normalized_name"),
	CONSTRAINT "merchants_name_check" CHECK (btrim("merchants"."normalized_name") <> ''),
	CONSTRAINT "merchants_logo_source_check" CHECK ("merchants"."logo_source" is null or "merchants"."logo_source" in ('favicon', 'upload', 'none'))
);
--> statement-breakpoint
CREATE TABLE "recurring_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"merchant_id" uuid,
	"category_id" uuid,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"interval" smallint DEFAULT 1 NOT NULL,
	"day_of_month" smallint,
	"start_on" date NOT NULL,
	"end_on" date,
	"next_run_on" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_rules_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "recurring_rules_kind_check" CHECK ("recurring_rules"."kind" in ('expense', 'income')),
	CONSTRAINT "recurring_rules_sign_check" CHECK (("recurring_rules"."kind" = 'expense' and "recurring_rules"."amount_cents" < 0) or ("recurring_rules"."kind" = 'income' and "recurring_rules"."amount_cents" > 0)),
	CONSTRAINT "recurring_rules_frequency_check" CHECK ("recurring_rules"."frequency" in ('weekly', 'monthly', 'yearly')),
	CONSTRAINT "recurring_rules_interval_check" CHECK ("recurring_rules"."interval" between 1 and 52),
	CONSTRAINT "recurring_rules_day_check" CHECK ("recurring_rules"."day_of_month" is null or "recurring_rules"."day_of_month" between 1 and 31),
	CONSTRAINT "recurring_rules_dates_check" CHECK ("recurring_rules"."end_on" is null or "recurring_rules"."end_on" >= "recurring_rules"."start_on")
);
--> statement-breakpoint
CREATE TABLE "transaction_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"transaction_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"label" text NOT NULL,
	"quantity" numeric(10, 3) DEFAULT '1' NOT NULL,
	"unit_price_cents" bigint,
	"total_cents" bigint NOT NULL,
	"category_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_items_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "transaction_items_user_tx_id_key" UNIQUE("user_id","transaction_id","id"),
	CONSTRAINT "transaction_items_quantity_check" CHECK ("transaction_items"."quantity" > 0),
	CONSTRAINT "transaction_items_position_check" CHECK ("transaction_items"."position" >= 0),
	CONSTRAINT "transaction_items_label_check" CHECK (btrim("transaction_items"."label") <> '')
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"occurred_on" date NOT NULL,
	"label" text NOT NULL,
	"notes" text,
	"merchant_id" uuid,
	"category_id" uuid,
	"recurring_rule_id" uuid,
	"transfer_group_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "transactions_user_id_id_kind_key" UNIQUE("user_id","id","kind"),
	CONSTRAINT "transactions_kind_check" CHECK ("transactions"."kind" in ('expense', 'income', 'transfer', 'reimbursement')),
	CONSTRAINT "transactions_sign_check" CHECK (("transactions"."kind" = 'expense' and "transactions"."amount_cents" < 0)
        or ("transactions"."kind" in ('income', 'reimbursement') and "transactions"."amount_cents" > 0)
        or ("transactions"."kind" = 'transfer' and "transactions"."amount_cents" <> 0)),
	CONSTRAINT "transactions_transfer_group_check" CHECK (("transactions"."kind" = 'transfer') = ("transactions"."transfer_group_id" is not null)),
	CONSTRAINT "transactions_label_check" CHECK (btrim("transactions"."label") <> '')
);
--> statement-breakpoint
CREATE TABLE "claim_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"claim_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"transaction_kind" text DEFAULT 'reimbursement' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_payments_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "claim_payments_claim_transaction_key" UNIQUE("user_id","claim_id","transaction_id"),
	CONSTRAINT "claim_payments_amount_check" CHECK ("claim_payments"."amount_cents" > 0),
	CONSTRAINT "claim_payments_kind_check" CHECK ("claim_payments"."transaction_kind" = 'reimbursement')
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"person_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"transaction_item_id" uuid,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "claims_share_key" UNIQUE NULLS NOT DISTINCT("user_id","transaction_id","transaction_item_id","person_id"),
	CONSTRAINT "claims_amount_check" CHECK ("claims"."amount_cents" > 0),
	CONSTRAINT "claims_status_check" CHECK ("claims"."status" in ('pending', 'reimbursed', 'gifted', 'cancelled')),
	CONSTRAINT "claims_resolved_check" CHECK (("claims"."status" = 'pending') = ("claims"."resolved_at" is null))
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "people_name_check" CHECK (btrim("people"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"transaction_id" uuid,
	"file_key" text NOT NULL,
	"original_filename" text,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"ocr_text" text,
	"extracted" jsonb,
	"confidence" jsonb,
	"return_deadline" date,
	"warranty_until" date,
	"validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "receipts_user_sha256_key" UNIQUE("user_id","sha256"),
	CONSTRAINT "receipts_status_check" CHECK ("receipts"."status" in ('uploaded', 'processing', 'to_review', 'validated', 'rejected', 'manual')),
	CONSTRAINT "receipts_size_check" CHECK ("receipts"."size_bytes" > 0),
	CONSTRAINT "receipts_sha256_check" CHECK ("receipts"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "receipts_validated_check" CHECK ("receipts"."status" <> 'validated' or "receipts"."validated_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"category_id" uuid,
	"period" text DEFAULT 'monthly' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "budgets_user_category_period_key" UNIQUE NULLS NOT DISTINCT("user_id","category_id","period","starts_on"),
	CONSTRAINT "budgets_period_check" CHECK ("budgets"."period" in ('monthly', 'yearly')),
	CONSTRAINT "budgets_amount_check" CHECK ("budgets"."amount_cents" > 0),
	CONSTRAINT "budgets_dates_check" CHECK ("budgets"."ends_on" is null or "budgets"."ends_on" >= "budgets"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"target_cents" bigint NOT NULL,
	"saved_cents" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"account_id" uuid,
	"target_date" date,
	"achieved_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "goals_target_check" CHECK ("goals"."target_cents" > 0),
	CONSTRAINT "goals_saved_check" CHECK ("goals"."saved_cents" >= 0),
	CONSTRAINT "goals_name_check" CHECK (btrim("goals"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "jobs_type_check" CHECK (btrim("jobs"."type") <> ''),
	CONSTRAINT "jobs_attempts_check" CHECK ("jobs"."max_attempts" >= 1 and "jobs"."attempts" >= 0 and "jobs"."attempts" <= "jobs"."max_attempts"),
	CONSTRAINT "jobs_lock_check" CHECK ("jobs"."status" <> 'running' or ("jobs"."locked_at" is not null and "jobs"."locked_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_fk" FOREIGN KEY ("user_id","parent_id") REFERENCES "public"."categories"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "public"."categories"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_merchant_fk" FOREIGN KEY ("user_id","merchant_id") REFERENCES "public"."merchants"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_default_category_fk" FOREIGN KEY ("user_id","default_category_id") REFERENCES "public"."categories"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_merchant_fk" FOREIGN KEY ("user_id","merchant_id") REFERENCES "public"."merchants"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "public"."categories"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_transaction_fk" FOREIGN KEY ("user_id","transaction_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "public"."categories"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_merchant_fk" FOREIGN KEY ("user_id","merchant_id") REFERENCES "public"."merchants"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "public"."categories"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_rule_fk" FOREIGN KEY ("user_id","recurring_rule_id") REFERENCES "public"."recurring_rules"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_payments" ADD CONSTRAINT "claim_payments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_payments" ADD CONSTRAINT "claim_payments_claim_fk" FOREIGN KEY ("user_id","claim_id") REFERENCES "public"."claims"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_payments" ADD CONSTRAINT "claim_payments_transaction_fk" FOREIGN KEY ("user_id","transaction_id","transaction_kind") REFERENCES "public"."transactions"("user_id","id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_person_fk" FOREIGN KEY ("user_id","person_id") REFERENCES "public"."people"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_transaction_fk" FOREIGN KEY ("user_id","transaction_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_transaction_item_fk" FOREIGN KEY ("user_id","transaction_id","transaction_item_id") REFERENCES "public"."transaction_items"("user_id","transaction_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_transaction_fk" FOREIGN KEY ("user_id","transaction_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "public"."categories"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_account_user_id_idx" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "categorization_rules_user_priority_idx" ON "categorization_rules" USING btree ("user_id","priority") WHERE "categorization_rules"."active";--> statement-breakpoint
CREATE INDEX "recurring_rules_user_next_run_idx" ON "recurring_rules" USING btree ("user_id","next_run_on") WHERE "recurring_rules"."active";--> statement-breakpoint
CREATE INDEX "transaction_items_user_tx_position_idx" ON "transaction_items" USING btree ("user_id","transaction_id","position");--> statement-breakpoint
CREATE INDEX "transaction_items_user_category_idx" ON "transaction_items" USING btree ("user_id","category_id");--> statement-breakpoint
CREATE INDEX "transactions_user_occurred_idx" ON "transactions" USING btree ("user_id","occurred_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_user_account_occurred_idx" ON "transactions" USING btree ("user_id","account_id","occurred_on");--> statement-breakpoint
CREATE INDEX "transactions_user_category_idx" ON "transactions" USING btree ("user_id","category_id");--> statement-breakpoint
CREATE INDEX "transactions_user_merchant_idx" ON "transactions" USING btree ("user_id","merchant_id");--> statement-breakpoint
CREATE INDEX "transactions_user_recurring_idx" ON "transactions" USING btree ("user_id","recurring_rule_id") WHERE "transactions"."recurring_rule_id" is not null;--> statement-breakpoint
CREATE INDEX "transactions_user_transfer_idx" ON "transactions" USING btree ("user_id","transfer_group_id") WHERE "transactions"."transfer_group_id" is not null;--> statement-breakpoint
CREATE INDEX "claim_payments_user_transaction_idx" ON "claim_payments" USING btree ("user_id","transaction_id");--> statement-breakpoint
CREATE INDEX "claims_user_person_status_idx" ON "claims" USING btree ("user_id","person_id","status");--> statement-breakpoint
CREATE INDEX "claims_user_status_idx" ON "claims" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_user_transaction_key" ON "receipts" USING btree ("user_id","transaction_id") WHERE "receipts"."transaction_id" is not null;--> statement-breakpoint
CREATE INDEX "receipts_user_status_idx" ON "receipts" USING btree ("user_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "receipts_user_return_idx" ON "receipts" USING btree ("user_id","return_deadline") WHERE "receipts"."return_deadline" is not null;--> statement-breakpoint
CREATE INDEX "receipts_user_warranty_idx" ON "receipts" USING btree ("user_id","warranty_until") WHERE "receipts"."warranty_until" is not null;--> statement-breakpoint
CREATE INDEX "jobs_status_run_at_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "jobs_running_locked_at_idx" ON "jobs" USING btree ("locked_at") WHERE "jobs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "jobs_user_id_idx" ON "jobs" USING btree ("user_id","created_at" DESC NULLS LAST);