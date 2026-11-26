-- What kind of task a comparison is, and the user's stated quality/cost/speed weights.
ALTER TABLE "Comparison" ADD COLUMN "taskType" TEXT NOT NULL DEFAULT 'general';
ALTER TABLE "Comparison" ADD COLUMN "priority" JSONB;
