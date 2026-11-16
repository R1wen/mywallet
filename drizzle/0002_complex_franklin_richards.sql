CREATE TABLE "recurring_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"rule_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_occurrences_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "recurring_occurrences_rule_due_key" UNIQUE("user_id","rule_id","due_on"),
	CONSTRAINT "recurring_occurrences_transaction_key" UNIQUE("user_id","transaction_id"),
	CONSTRAINT "recurring_occurrences_status_check" CHECK ("recurring_occurrences"."status" in ('planned', 'confirmed', 'skipped')),
	CONSTRAINT "recurring_occurrences_link_check" CHECK (("recurring_occurrences"."status" = 'confirmed') = ("recurring_occurrences"."transaction_id" is not null)),
	CONSTRAINT "recurring_occurrences_amount_check" CHECK ("recurring_occurrences"."amount_cents" <> 0)
);
--> statement-breakpoint
ALTER TABLE "recurring_rules" DROP CONSTRAINT "recurring_rules_kind_check";--> statement-breakpoint
ALTER TABLE "recurring_rules" DROP CONSTRAINT "recurring_rules_sign_check";--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD COLUMN "to_account_id" uuid;--> statement-breakpoint
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_rule_fk" FOREIGN KEY ("user_id","rule_id") REFERENCES "public"."recurring_rules"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_transaction_fk" FOREIGN KEY ("user_id","transaction_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_occurrences_user_due_idx" ON "recurring_occurrences" USING btree ("user_id","due_on");--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_to_account_fk" FOREIGN KEY ("user_id","to_account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_kind_check" CHECK ("recurring_rules"."kind" in ('expense', 'income', 'transfer'));--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_sign_check" CHECK (("recurring_rules"."kind" = 'expense' and "recurring_rules"."amount_cents" < 0 and "recurring_rules"."to_account_id" is null)
        or ("recurring_rules"."kind" = 'income' and "recurring_rules"."amount_cents" > 0 and "recurring_rules"."to_account_id" is null)
        or ("recurring_rules"."kind" = 'transfer' and "recurring_rules"."amount_cents" < 0 and "recurring_rules"."to_account_id" is not null
            and "recurring_rules"."to_account_id" <> "recurring_rules"."account_id"));