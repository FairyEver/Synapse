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

## Current repository structure

- Privileged Electron code lives in `electron/`.
- Renderer code lives in `src/`.
- The current business-module directory is `src/modules/`, not `src/features/`.
- Shared shell state and orchestration live in `src/app-shell/`.
- Shared UI components live in `src/components/` and `src/components/ui/`.
- Shared pure utilities live in `src/lib/`.
- Shared renderer-wide types live in `src/types/`.
- Existing first-class modules are `rules`, `skills`, and `settings`.

## Core rules

- Follow the existing project structure before creating new files or folders.
- Do not introduce a parallel architecture such as `src/features/` unless the task is an explicit migration.
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
- For feature UI, prefer shadcn/ui composition and the default preset styles documented in `doc/DESIGN.md`.
- When a task changes UI or styling, use existing shadcn components and theme tokens before adding custom visual treatment.
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

- Use the active shadcn preset and CSS variable tokens defined by `components.json` and `src/styles/globals.css`.
- Prefer neutral palette tokens such as `bg-background`, `text-foreground`, `bg-card`, `border-border`, and `bg-muted`.
- Use the preset's default font imports and tokenized font roles instead of adding separate brand display styles.
- Prefer stock shadcn radius, border, shadow, and focus-ring treatment over custom arbitrary values.
- Compose from shadcn components before hand-rolling parallel UI primitives.
- Avoid hard-coded brand colors, custom shadow systems, decorative gradients, and page-specific visual languages unless the task explicitly asks for them.

## Placement rules

- New renderer business logic should usually live inside the relevant module under `src/modules/<module>/`.
- Inside a module, prefer `components/`, `hooks/`, `services/`, `types.ts`, and `utils.ts` when those boundaries help.
- Shared pure helpers belong in `src/lib/`.
- Shared renderer-wide types belong in `src/types/`.
- When Electron logic grows, split it into clearly named files under `electron/` instead of inflating `electron/main.ts`.
- Keep `src/App.tsx` focused on app-shell composition and top-level tab orchestration, not deep feature logic.

## Before finishing

- Check whether an existing file already solves part of the task.
- Keep the final diff minimal and focused.
- Ensure naming is explicit and consistent.
- Update types, validation, and error handling when behavior changes.
- Make sure another engineer can extend the code without reverse-engineering hidden abstractions.
