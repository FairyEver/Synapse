# Synapse Renderer Rules

These rules apply to all renderer-side work under `src/`.

## Design authority

- For any UI, styling, layout, typography, color, spacing, surface, card, button, form, or interaction appearance change, follow `/Users/liyang/Documents/code/github/Synapse/doc/DESIGN.md` strictly.
- `doc/DESIGN.md` defines the repository's current shadcn preset baseline and overrides ad hoc page-level styling.
- Do not introduce a competing design language inside renderer code.

## Required visual defaults

- The active shadcn preset is `radix-nova` and the current primitive base is Radix.
- Use the active shadcn preset tokens from `components.json` and `src/styles/globals.css`.
- Prefer shared shadcn components from `src/components/ui/` over custom renderer-side primitives.
- Use this order for UI work: existing business composition that already fits -> existing `src/components/ui/` component -> add a shadcn component under `src/components/ui/` -> thin module-local composition -> last-resort custom primitive.
- Keep colors, radius, borders, shadows, and focus states on stock shadcn defaults unless the task explicitly changes the preset.
- Prefer tokenized utilities such as `bg-background`, `text-foreground`, `border-border`, `bg-muted`, and `text-muted-foreground`.
- Use Tailwind mainly for layout, spacing, sizing, responsive behavior, overflow, and simple typography instead of re-skinning component surfaces.
- Keep renderer styling simple and consistent rather than introducing a separate shell-specific brand layer.
- Do not import renderer primitives from `@base-ui/react` or introduce another primitive layer when `src/components/ui/` already covers the need.
- When a primitive is missing, add it through the existing shadcn setup and keep the project on the Radix base.

## User-facing copy

- Renderer copy is product copy for users, not developer notes.
- Do not surface roadmap items, implementation status, architecture explanations, state-boundary reasoning, or style rationale in the UI.
- Keep empty, loading, disabled, helper, and error text short and action-oriented.
- If a sentence does not help the user complete the current task, remove it.

## Renderer boundaries

- Keep privileged logic out of renderer code.
- Use preload APIs for privileged actions.
- Keep business logic out of oversized presentational components when possible.
