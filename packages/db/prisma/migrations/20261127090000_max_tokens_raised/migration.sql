-- A reasoning model that ran out of tokens is retried once with a bigger max_tokens; record it.
ALTER TABLE "CompareResult" ADD COLUMN "maxTokensRaisedTo" INTEGER;
ALTER TABLE "EvalResult" ADD COLUMN "maxTokensRaisedTo" INTEGER;
