# Synapse Agent Rules

Follow this file first for every task in this repository.

If a task touches architecture or file placement, also read:

- `doc/engineering-standards.md`
- `doc/project-structure.md`

If a task touches UI behavior, styling, visual design, typography, color, spacing, component appearance, theming, or any renderer-side presentation, you must read and follow:

- `doc/DESIGN.md`
- `doc/ui-rules.md`

For any visual decision, `doc/DESIGN.md` is the canonical authority for the repository's current shadcn-based visual baseline.

## Stack

- Electron
- React
- Tailwind CSS
- shadcn/ui
- TypeScript

## Current UI foundation

- The active shadcn preset is `radix-nova` in `desktop/components.json`.
- The current primitive base is Radix, not Base UI.
- `desktop/src/components/ui/` must stay aligned with the current shadcn + Radix setup.
- Do not add or reintroduce `@base-ui/react` unless the task is an explicit migration approved by the user.
- When adding or reinstalling shadcn components, preserve the current Radix base. If a task requires shadcn re-initialization or reinstall, use the Radix path rather than switching to `base`.

## Current repository structure

- This repo is a pnpm monorepo. The workspace root hosts shared docs (`doc/`, `AGENTS.md`, `CLAUDE.md`, `README.md`), `.github/` CI, and the monorepo `package.json` / `pnpm-workspace.yaml`. Source code lives in the `desktop/` subpackage published as `@synapse/desktop`.
- Run scripts from the repo root (e.g. `pnpm dev`, `pnpm build`, `pnpm typecheck`); they delegate into `desktop/` via `pnpm --filter @synapse/desktop`.
- Privileged Electron code lives in `desktop/electron/`.
- Renderer code lives in `desktop/src/`.
- Shared shell state and orchestration live in `desktop/src/app-shell/`.
- Shared UI components live in `desktop/src/components/` and `desktop/src/components/ui/`.
- Shared pure utilities live in `desktop/src/lib/`.
- Shared renderer-wide types live in `desktop/src/types/`.
- New business modules should live in `desktop/src/modules/`, not `desktop/src/features/`.
- Planned first-class modules include `rules`, `skills`, and `settings`; do not assume those directories already exist unless the task creates them.

## Core rules

- Follow the existing project structure before creating new files or folders.
- Do not introduce a parallel architecture such as `desktop/src/features/` unless the task is an explicit migration.
- Prefer small, local changes over broad rewrites.
- Reuse existing components, hooks, services, and utilities before adding new ones.
- Do not add dependencies unless explicitly asked.
- Use function components only. Keep components and hooks pure.
- Put side effects in event handlers, effects, Electron main-process code, or dedicated services.
- Use strict TypeScript. Avoid `any`; if it is truly unavoidable, isolate it and explain it.
- Keep renderer, preload, and main-process boundaries strict.
- Filesystem, git, installation, download, dialog, updater, and OS logic belong in Electron main-process code, never in React components.
- Renderer code may only access privileged capabilities through narrow, typed preload APIs.
- Never expose raw `ipcRenderer`, `window.require`, or broad Electron APIs to the renderer.
- Handle async errors explicitly. Do not silently swallow failures.
- Preserve the existing interaction patterns unless the task explicitly changes them.
- Never start a development server for verification unless the user explicitly asks. After code changes, leave runtime validation to the user.
- For feature UI, prefer shadcn/ui composition and the default preset styles documented in `doc/DESIGN.md`.
- When a task changes UI or styling, use existing shadcn components and theme tokens before adding custom visual treatment.
- Treat the current renderer UI stack as `shadcn/ui + Radix`; do not silently swap the primitive library or preset.
- Prefer `desktop/src/components/ui/` shadcn primitives over creating new general-purpose components in `desktop/src/components/`.
- If a needed UI primitive is missing, add the official shadcn component to `desktop/src/components/ui/` or match CLI output closely before hand-rolling a custom primitive.
- If `doc/DESIGN.md` specifies the active shadcn preset, font imports, tokens, or component usage rules, follow those over ad hoc page-level overrides.
- Keep the app shell and feature modules on the same shared shadcn baseline instead of maintaining parallel visual systems.
- If a component, hook, or service grows too large, split it into smaller, well-named units.

## Karpathy-inspired execution rules

Behavioral guidelines to reduce common LLM coding mistakes. Merge with the project-specific rules in this file.

Tradeoff: These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

- "Add validation" -> "Write tests for invalid inputs, then make them pass"
- "Fix the bug" -> "Write a test that reproduces it, then make it pass"
- "Refactor X" -> "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```text
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Design guardrails

For any UI or styling task, treat these as default requirements unless the user explicitly asks for an exception:

- Use the active shadcn preset and CSS variable tokens defined by `desktop/components.json` and `desktop/src/styles/globals.css`.
- Prefer neutral palette tokens such as `bg-background`, `text-foreground`, `bg-card`, `border-border`, and `bg-muted`.
- Use the preset's default font imports and tokenized font roles instead of adding separate brand display styles.
- Prefer stock shadcn radius, border, shadow, and focus-ring treatment over custom arbitrary values.
- Use this UI decision order: existing business composition that already fits -> existing `desktop/src/components/ui/` component -> new shadcn component added under `desktop/src/components/ui/` -> thin module-local composition -> last-resort custom primitive.
- Compose from shadcn components before hand-rolling parallel UI primitives.
- Let Tailwind primarily handle layout, spacing, sizing, responsive behavior, overflow, and simple typography; do not use it as the main way to restyle buttons, inputs, cards, dialogs, or tabs.
- Do not create a new shared presentational primitive in `desktop/src/components/` when a shadcn equivalent exists or can be added.
- Avoid hard-coded brand colors, custom shadow systems, decorative gradients, and page-specific visual languages unless the task explicitly asks for them.

## Product copy guardrails

- Treat all UI copy as product copy for end users, not implementation notes for developers.
- Never put roadmap notes, future-phase plans, architectural rationale, state-boundary explanations, technical caveats, or design self-justification into the interface unless the user explicitly needs that information to complete the current task.
- Empty, loading, disabled, and error states should be brief and action-oriented. Tell the user what they can do now or what just happened, in plain language.
- Prefer one clear next step over multi-sentence explanation.
- Before keeping any UI sentence, ask: "Would a normal user need this to use the feature right now?" If not, remove it.

## Placement rules

- New renderer business logic should usually live inside the relevant module under `desktop/src/modules/<module>/`.
- Inside a module, prefer `components/`, `hooks/`, `services/`, `types.ts`, and `utils.ts` when those boundaries help.
- Shared pure helpers belong in `desktop/src/lib/`.
- Shared renderer-wide types belong in `desktop/src/types/`.
- When Electron logic grows, split it into clearly named files under `desktop/electron/` instead of inflating `desktop/electron/main.ts`.
- Keep `desktop/src/App.tsx` focused on app-shell composition and top-level tab orchestration, not deep feature logic.

## Before finishing

- Check whether an existing file already solves part of the task.
- Keep the final diff minimal and focused.
- Ensure naming is explicit and consistent.
- Update types, validation, and error handling when behavior changes.
- Make sure another engineer can extend the code without reverse-engineering hidden abstractions.
