---
target: Webhook variables dialog screenshot / desktop/src/modules/automation/editor/trigger-variables-dialog.tsx
total_score: 27
p0_count: 0
p1_count: 2
timestamp: 2026-06-08T00-00-35Z
slug: les-automation-editor-trigger-variables-dialog-tsx
---
## Design Health Score

Total: 27/40. Solid implementation baseline, weak task fit.

## Anti-Patterns Verdict

Not AI-slop. The surface uses neutral tokens, shadcn-like control vocabulary, no decorative gradients, no hardcoded colors detected by impeccable detector. The main issue is not taste, it is UX shape: a variable picker is rendered like a dense settings dialog.

Deterministic scan: clean. `detect.mjs --json desktop/src/modules/automation/editor/trigger-variables-dialog.tsx` returned `[]`.

## Overall Impression

The dialog is visually restrained and consistent with Synapse, but it under-communicates the primary action. Users need to find a variable and copy/insert it quickly; the current layout makes every variable look like a passive card, while the copy affordance is either hidden until after action or only explicit for dynamic variables.

## What Works

- The left group filter is useful and keeps the 23 variables from becoming one flat list.
- Search is placed before the scroll list, which matches the likely first action.
- Static detection found no obvious style-policy violations: no AI-gradient, arbitrary color, or custom palette problem.

## Priority Issues

[P1] Copy/insert affordance is too hidden
Why it matters: Static rows are clickable buttons, but visually read as inert bordered items. The user has to infer that clicking the entire row copies the template.
Fix: Add a trailing copy icon button or make the row show a persistent low-emphasis Copy action. Keep the row itself selectable only if it has a visible selected/copy state.
Suggested command: $impeccable polish

[P1] The content area has nested-container weight
Why it matters: The dialog surface contains a bordered scroll panel, then each variable has another bordered rounded row. This creates a card-within-card feeling and makes scanning slower.
Fix: Flatten the list: use row separators or a single list surface. Reserve borders for the outer scroll area or for dynamic path rows, not every static variable.
Suggested command: $impeccable distill

[P2] Group count is duplicated without adding meaning
Why it matters: Counts appear in the left nav and again in the section header. In the screenshot, the right-side badge competes with the section title and does not help action.
Fix: Keep counts in the sidebar only. In the content header, use the space for section label and optional compact copy/insert behavior.
Suggested command: $impeccable clarify

[P2] Search and filter hierarchy is visually uneven
Why it matters: The search box dominates horizontally while the left filter uses button styling; both are valid controls, but they do not read as one filtering system.
Fix: Treat left categories as Tabs/Listbox navigation and search as toolbar control. Give the content area a clear toolbar row: search, optional group count, maybe clear search.
Suggested command: $impeccable layout

[P2] Dynamic variables have better affordance than static variables
Why it matters: Dynamic rows show an explicit Copy button, while static rows rely on hidden whole-row click. This inconsistency increases hesitation.
Fix: Standardize both rows around the same trailing action vocabulary. Static rows can show icon-only Copy; dynamic rows can keep text Copy because they include input.
Suggested command: $impeccable polish

## Persona Red Flags

Power user: wants to paste variables repeatedly. The dialog supports copy, but lack of visible copy affordance slows repeated use.
First-time automation user: sees `{{trigger.type}}` but no visible action cue. They may not realize row click copies.
Keyboard user: focus exists in code, but the visual model does not communicate keyboard flow through groups, search, rows, and copy actions.

## Minor Observations

- The modal is very wide for six visible variables; better density would reduce eye travel.
- `placeholder="path"` in dynamic inputs is developer-facing English inside a Chinese UI.
- `没有匹配变量` is fine, but could be paired with clearing search if search is non-empty.

## Questions to Consider

- Is the intended action copy to clipboard, insert into the focused editor field, or both?
- Should variables behave like command-palette results instead of cards?
- Does the dialog need to show all groups at once, or should selecting a group replace the content list?
