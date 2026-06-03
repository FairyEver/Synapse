# Usage Price Rule Migration And Reset Design

## Context

Usage Analysis stores editable model price rules in `usage_model_prices`. Built-in defaults live in `desktop/electron/services/usage-analysis/pricing.ts`. The current seed path only inserts defaults when the table is empty, so existing users who already initialized or edited rules do not receive newly added built-in model prices.

The price rules dialog currently supports edit, add, delete, and save. It does not provide a way to restore current built-in defaults.

## Goals

- On schema initialization, append missing built-in price rules for existing usage databases.
- Preserve user edits: do not overwrite an existing rule with the same `id` or `modelPattern`.
- Add a reset action in the price rules dialog that restores the full built-in default rule set.
- When price rules change, make Claude Code refresh reparse unchanged files so old unpriced events can be recalculated.

## Non-Goals

- Do not introduce external price fetching.
- Do not add tiered pricing.
- Do not redesign the price rules table.
- Do not silently overwrite user-customized rules during migration.

## Design

Add a pricing migration helper that reads existing rules, compares them with `DEFAULT_USAGE_PRICE_RULES`, and appends only defaults whose `id` and `modelPattern` are both absent. The helper should mark a pricing meta key after running so the migration is stable, but it should be safe to run repeatedly.

Add a reset helper that replaces `usage_model_prices` with `DEFAULT_USAGE_PRICE_RULES`. This is an explicit user action, unlike migration, so it intentionally overwrites the current rule list.

Expose reset through the existing Usage Analysis IPC bridge and preload API. The renderer dialog will call `resetPricingRules()` after an `AlertDialog` confirmation, update local rows from the returned defaults, call `onSaved`, and show the existing success/error notifications.

Use the existing `pricing_rules_hash` scan state for Claude Code refresh decisions. If a stored file has the same fingerprint and parser version but a different price-rule hash, classify it as `replace` so persisted usage events are rewritten with current costs and affected aggregates are rebuilt.

## Testing

- Pricing tests cover append-only built-in migration and explicit reset behavior.
- CC scan state tests cover price hash changes causing `replace`.
- Report refresh tests cover repricing unchanged files after price rules change.
- UI tests cover the reset button, confirmation, bridge call, local row update, and `onSaved`.
