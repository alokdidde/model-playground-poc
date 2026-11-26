-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "Comparison" (
    "id" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "models" TEXT[],
    "maxTokens" INTEGER NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "idempotencyKey" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Comparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompareResult" (
    "id" TEXT NOT NULL,
    "comparisonId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "CallStatus" NOT NULL,
    "output" TEXT NOT NULL,
    "problem" JSONB,
    "latencyMs" INTEGER NOT NULL,
    "ttftMs" INTEGER,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "tokensEstimated" BOOLEAN NOT NULL,
    "costUsd" DOUBLE PRECISION,
    "attempts" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompareResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Judgement" (
    "id" TEXT NOT NULL,
    "comparisonId" TEXT NOT NULL,
    "judgeModel" TEXT NOT NULL,
    "selfJudged" BOOLEAN NOT NULL,
    "winnerModel" TEXT,
    "rationale" TEXT NOT NULL,
    "scores" JSONB NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "costUsd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Judgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "comparisonId" TEXT NOT NULL,
    "preferredModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalRun" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "models" TEXT[],
    "judgeModel" TEXT NOT NULL,
    "maxTokens" INTEGER NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT,
    "requestHash" TEXT,
    "totalCalls" INTEGER NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "EvalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalPrompt" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "expected" TEXT,
    "winnerModel" TEXT,
    "judgeRationale" TEXT,
    "judgedAt" TIMESTAMP(3),

    CONSTRAINT "EvalPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "promptIndex" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "status" "CallStatus" NOT NULL,
    "output" TEXT NOT NULL,
    "problem" JSONB,
    "latencyMs" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "tokensEstimated" BOOLEAN NOT NULL,
    "costUsd" DOUBLE PRECISION,
    "attempts" INTEGER NOT NULL,
    "score" DOUBLE PRECISION,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_lease" (
    "id" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "tokens_reserved" INTEGER NOT NULL,
    "tokens_actual" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "released_at" TIMESTAMP(3),

    CONSTRAINT "rate_lease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_cooldown" (
    "bucket" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_cooldown_pkey" PRIMARY KEY ("bucket")
);

-- CreateIndex
CREATE UNIQUE INDEX "Comparison_idempotencyKey_key" ON "Comparison"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Comparison_createdAt_idx" ON "Comparison"("createdAt");

-- CreateIndex
CREATE INDEX "CompareResult_model_idx" ON "CompareResult"("model");

-- CreateIndex
CREATE UNIQUE INDEX "CompareResult_comparisonId_model_key" ON "CompareResult"("comparisonId", "model");

-- CreateIndex
CREATE UNIQUE INDEX "Judgement_comparisonId_key" ON "Judgement"("comparisonId");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_comparisonId_key" ON "Vote"("comparisonId");

-- CreateIndex
CREATE UNIQUE INDEX "EvalRun_idempotencyKey_key" ON "EvalRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EvalRun_createdAt_idx" ON "EvalRun"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvalPrompt_runId_index_key" ON "EvalPrompt"("runId", "index");

-- CreateIndex
CREATE INDEX "EvalResult_model_idx" ON "EvalResult"("model");

-- CreateIndex
CREATE UNIQUE INDEX "EvalResult_runId_promptIndex_model_key" ON "EvalResult"("runId", "promptIndex", "model");

-- CreateIndex
CREATE INDEX "rate_lease_bucket_created_at_idx" ON "rate_lease"("bucket", "created_at");

-- AddForeignKey
ALTER TABLE "CompareResult" ADD CONSTRAINT "CompareResult_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "Comparison"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Judgement" ADD CONSTRAINT "Judgement_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "Comparison"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "Comparison"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalPrompt" ADD CONSTRAINT "EvalPrompt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EvalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalResult" ADD CONSTRAINT "EvalResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EvalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
