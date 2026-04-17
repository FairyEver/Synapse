# Synapse Renderer Rules

These rules apply to all renderer-side work under `src/`.

## Design authority

- For any UI, styling, layout, typography, color, spacing, surface, card, button, form, or interaction appearance change, follow `/Users/liyang/Documents/code/github/Synapse/doc/DESIGN.md` strictly.
- `doc/DESIGN.md` defines the repository's current shadcn preset baseline and overrides ad hoc page-level styling.
- Do not introduce a competing design language inside renderer code.

## Required visual defaults

- Use the active shadcn preset tokens from `components.json` and `src/styles/globals.css`.
- Prefer shared shadcn components from `src/components/ui/` over custom renderer-side primitives.
- Keep colors, radius, borders, shadows, and focus states on stock shadcn defaults unless the task explicitly changes the preset.
- Prefer tokenized utilities such as `bg-background`, `text-foreground`, `border-border`, `bg-muted`, and `text-muted-foreground`.
- Keep renderer styling simple and consistent rather than introducing a separate shell-specific brand layer.

## Renderer boundaries

- Keep privileged logic out of renderer code.
- Use preload APIs for privileged actions.
- Keep business logic out of oversized presentational components when possible.
