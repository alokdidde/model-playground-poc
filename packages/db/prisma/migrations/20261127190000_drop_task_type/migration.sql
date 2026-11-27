-- The judge reads the prompt directly, so runs carry no task type.
ALTER TABLE "Comparison" DROP COLUMN "taskType";
