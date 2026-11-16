CREATE TABLE "bank_import_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"signature" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_import_presets_user_signature_key" UNIQUE("user_id","signature"),
	CONSTRAINT "bank_import_presets_signature_check" CHECK (btrim("bank_import_presets"."signature") <> '')
);
--> statement-breakpoint
CREATE TABLE "import_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"structurer" text DEFAULT 'rules' NOT NULL,
	"gemini_consent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_settings_structurer_check" CHECK ("import_settings"."structurer" in ('rules', 'ollama', 'gemini')),
	CONSTRAINT "import_settings_gemini_consent_check" CHECK ("import_settings"."structurer" <> 'gemini' or "import_settings"."gemini_consent_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "receipt_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"receipt_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_files_receipt_kind_key" UNIQUE("user_id","receipt_id","kind"),
	CONSTRAINT "receipt_files_kind_check" CHECK ("receipt_files"."kind" in ('original', 'thumbnail')),
	CONSTRAINT "receipt_files_size_check" CHECK ("receipt_files"."size_bytes" > 0 and "receipt_files"."size_bytes" = octet_length("receipt_files"."data"))
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "bank_line_key" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "bank_label" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "ocr_engine" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "structurer" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "duplicate_key" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "bank_import_presets" ADD CONSTRAINT "bank_import_presets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_import_presets" ADD CONSTRAINT "bank_import_presets_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_settings" ADD CONSTRAINT "import_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_files" ADD CONSTRAINT "receipt_files_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_files" ADD CONSTRAINT "receipt_files_receipt_fk" FOREIGN KEY ("user_id","receipt_id") REFERENCES "public"."receipts"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_user_bank_line_key" ON "transactions" USING btree ("user_id","bank_line_key") WHERE "transactions"."bank_line_key" is not null;--> statement-breakpoint
CREATE INDEX "receipts_user_duplicate_idx" ON "receipts" USING btree ("user_id","duplicate_key") WHERE "receipts"."duplicate_key" is not null;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bank_line_key_check" CHECK ("transactions"."bank_line_key" is null or "transactions"."bank_line_key" ~ '^[0-9a-f]{64}$');