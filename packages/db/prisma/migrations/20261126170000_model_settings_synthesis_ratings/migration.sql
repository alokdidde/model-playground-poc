-- Per-model settings actually sent with each compare call, and the user's thumbs up/down.
ALTER TABLE "CompareResult" ADD COLUMN "settings" JSONB;
ALTER TABLE "CompareResult" ADD COLUMN "rating" INTEGER;

-- The merged ("synthesized") answer for a comparison.
ALTER TABLE "Comparison" ADD COLUMN "synthesis" TEXT;
ALTER TABLE "Comparison" ADD COLUMN "synthesisModel" TEXT;
