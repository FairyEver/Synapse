-- Keep legacy 500/2000 buy-ins and 10-seat rooms valid while accepting the current presets.
-- Replace the check atomically; a busy table aborts within five seconds without changing it.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "GamePokerRoom"
  DROP CONSTRAINT "GamePokerRoom_rules",
  ADD CONSTRAINT "GamePokerRoom_rules"
    CHECK ("maxSeats" BETWEEN 2 AND 10 AND "buyIn" IN (500,1000,2000,5000,10000,50000));

COMMIT;
