-- Batch evals carry the same task type, priority and per-model settings as compare.
ALTER TABLE "EvalRun" ADD COLUMN "taskType" TEXT NOT NULL DEFAULT 'general';
ALTER TABLE "EvalRun" ADD COLUMN "priority" JSONB;
ALTER TABLE "EvalRun" ADD COLUMN "modelSettings" JSONB;
ALTER TABLE "EvalRun" ADD COLUMN "sourceComparisonId" TEXT;
ALTER TABLE "EvalResult" ADD COLUMN "settings" JSONB;
