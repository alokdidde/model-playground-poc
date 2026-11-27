-- CreateTable
CREATE TABLE "rate_event" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "model" TEXT,
    "tag" TEXT,
    "attempt" INTEGER,
    "ms" INTEGER,
    "data" JSONB,

    CONSTRAINT "rate_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_event_at_idx" ON "rate_event"("at");

-- CreateIndex
CREATE INDEX "rate_event_tag_at_idx" ON "rate_event"("tag", "at");
