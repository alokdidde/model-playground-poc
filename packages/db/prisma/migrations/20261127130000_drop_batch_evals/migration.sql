-- Batch evals were cut from the PoC (see docs/DECISIONS.md). This drops their
-- tables and any eval data in them. DBOS kept its checkpoints in a separate
-- system database, which is not touched here.
DROP TABLE "EvalResult";
DROP TABLE "EvalPrompt";
DROP TABLE "EvalRun";
