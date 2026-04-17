# Synapse Agent Rules

Follow this file first for every task in this repository.

If a task touches architecture or file placement, also read:

- `doc/engineering-standards.md`
- `doc/project-structure.md`

If a task touches UI behavior, styling, visual design, typography, color, spacing, component appearance, theming, or any renderer-side presentation, you must read and follow:

- `doc/DESIGN.md`
- `doc/ui-rules.md`

For any visual decision, `doc/DESIGN.md` is the canonical authority and overrides older or more generic UI guidance.

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
- Preserve the existing visual language and interaction patterns.
- For feature UI, prefer shadcn/ui composition and Tailwind utilities that support the design system in `doc/DESIGN.md`.
- When a task changes UI or styling, do not invent a new visual direction. Match `doc/DESIGN.md` strictly.
- If `doc/DESIGN.md` specifies typography, palette, radius, spacing, shadows, or component treatment, follow it even when a default shadcn/ui style would be simpler.
- The app shell already contains branded styling. Preserve it and evolve feature modules toward the same `doc/DESIGN.md` language instead of introducing a competing style.
- If a component, hook, or service grows too large, split it into smaller, well-named units.

## Design guardrails

For any UI or styling task, treat these as default requirements unless the user explicitly asks for an exception:

- Use the warm parchment-based Claude-inspired palette defined in `doc/DESIGN.md`.
- Keep neutrals warm-toned. Do not introduce cool blue-grays.
- Use serif headings and sans-serif UI/body text according to `doc/DESIGN.md`.
- Keep serif heading weight at 500 or below.
- Use terracotta as the primary chromatic accent, not a broad rainbow palette.
- Prefer gradient-free surfaces. Depth should come from warm surfaces, borders, and ring shadows.
- Prefer warm ring shadows and subtle borders over heavy drop shadows.
- Keep corners soft and rounded. Do not use sharp card or button corners.
- Preserve the editorial, calm, high-whitespace rhythm from `doc/DESIGN.md`.
- Do not add techy/glossy styling that conflicts with the Claude-inspired art direction.

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
