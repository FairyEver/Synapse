CREATE TABLE "ProblemFeedback" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "content" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProblemFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProblemFeedback_receivedAt_id_idx"
ON "ProblemFeedback" ("receivedAt" DESC, "id" DESC);
