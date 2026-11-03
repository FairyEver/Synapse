# Poker Table Motion Implementation Plan

> For agentic workers: use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Give the Web table shared motion for dealing, changing cards, drawing abilities, casting and showing real chip payments.

**Architecture:** Derive short presentation batches from consecutive authorized table snapshots and the existing public hand log. Play from measured DOM anchors with GSAP. Keep chip transfers and their completion callbacks in the existing chip presentation. Extend the existing pointer interaction with pickup, landing and return feedback.

**Tech Stack:** React, TypeScript, GSAP, Vitest.

**Spec:** [Game UI](../../agents/game-ui.md).

## Global constraints

Use shared actions rather than card-specific rules. New ability motion applies to cards-v2. Keep old room recipes and visibility rules. Initial, stale and reduced-motion snapshots display their final state. Preserve payment amounts, actual turn timing and the settlement barrier.

## Review focus

Check public and owner card visibility, duplicate snapshots, settlement without showdown, actual versus waived payments and interrupted motion during scene changes.

- [x] Add regressions for new-hand and board dealing, deduplicated public card changes, private draw visibility and payment association. Run the Dashboard Vitest files.
- [x] Add the snapshot planner and GSAP stage for deal, cast, fold, exchange, shuffle and draw. Wire the stage into Table with the existing chip presentation callbacks.
- [x] Add pickup, invalid-drop return and accepted-drop landing to the existing hand dock. Cover normal and reduced motion with the dock regression.
- [x] Run the poker unit suite and Dashboard production build. Review the staged diff and commit the scoped changes locally.
