-- The judge now scores the answers in two orders; record how many and whether they agreed.
ALTER TABLE "Judgement" ADD COLUMN "orders" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Judgement" ADD COLUMN "positionConsistent" BOOLEAN;
ALTER TABLE "EvalPrompt" ADD COLUMN "positionConsistent" BOOLEAN;
