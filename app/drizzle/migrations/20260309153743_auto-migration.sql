ALTER TABLE "Song" ADD COLUMN "recommendation" text;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN "enableRecommendation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN "requireRecommendation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN "recommendationMinLength" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN "recommendationMaxLength" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "SystemSettings" DROP COLUMN "gonganNumber";