-- Preserve funding classification with each immutable hand summary, including cold copies.
ALTER TABLE "GamePokerHandSummary" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'points';
ALTER TABLE "GamePokerHandSummary" ADD CONSTRAINT "GamePokerHandSummary_mode_check" CHECK ("mode" IN ('points','practice'));
