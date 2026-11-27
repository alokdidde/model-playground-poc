-- Generation speed and reasoning flag for every call; TTFT for batch calls (now streamed);
-- per-criterion judge scores and automatic checks for batch results.
ALTER TABLE "CompareResult" ADD COLUMN "outputTokensPerSec" DOUBLE PRECISION;
ALTER TABLE "CompareResult" ADD COLUMN "reasoned" BOOLEAN;

ALTER TABLE "EvalResult" ADD COLUMN "ttftMs" INTEGER;
ALTER TABLE "EvalResult" ADD COLUMN "outputTokensPerSec" DOUBLE PRECISION;
ALTER TABLE "EvalResult" ADD COLUMN "reasoned" BOOLEAN;
ALTER TABLE "EvalResult" ADD COLUMN "criteria" JSONB;
ALTER TABLE "EvalResult" ADD COLUMN "checks" JSONB;
