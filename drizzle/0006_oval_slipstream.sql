CREATE TABLE "subscription_dismissals" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_dismissals_pkey" PRIMARY KEY("user_id","key"),
	CONSTRAINT "subscription_dismissals_key_check" CHECK (char_length("subscription_dismissals"."key") between 3 and 300)
);
--> statement-breakpoint
ALTER TABLE "subscription_dismissals" ADD CONSTRAINT "subscription_dismissals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;