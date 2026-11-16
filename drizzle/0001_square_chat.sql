CREATE TABLE "logo_cache" (
	"domain" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"content_type" text,
	"data" "bytea",
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "logo_cache_status_check" CHECK ("logo_cache"."status" in ('ok', 'missing')),
	CONSTRAINT "logo_cache_payload_check" CHECK (("logo_cache"."status" = 'ok' and "logo_cache"."data" is not null and "logo_cache"."content_type" is not null
            and octet_length("logo_cache"."data") <= 65536)
        or ("logo_cache"."status" = 'missing' and "logo_cache"."data" is null))
);
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_kind_check";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_sign_check";--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "logo_data" "bytea";--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "logo_content_type" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_logo_data_check" CHECK (("merchants"."logo_data" is null and "merchants"."logo_content_type" is null)
        or ("merchants"."logo_content_type" in ('image/png', 'image/jpeg', 'image/webp')
            and octet_length("merchants"."logo_data") <= 262144));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_kind_check" CHECK ("transactions"."kind" in ('expense', 'income', 'transfer', 'reimbursement', 'refund'));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_sign_check" CHECK (("transactions"."kind" = 'expense' and "transactions"."amount_cents" < 0)
        or ("transactions"."kind" in ('income', 'reimbursement', 'refund') and "transactions"."amount_cents" > 0)
        or ("transactions"."kind" = 'transfer' and "transactions"."amount_cents" <> 0));