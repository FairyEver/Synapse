# Synapse Renderer Rules

These rules apply to all renderer-side work under `src/`.

## Design authority

- For any UI, styling, layout, typography, color, spacing, surface, card, button, form, or interaction appearance change, follow `/Users/liyang/Documents/code/github/Synapse/doc/DESIGN.md` strictly.
- `doc/DESIGN.md` overrides generic defaults from shadcn/ui when visual treatment differs.
- Do not introduce a competing design language inside renderer code.

## Required visual defaults

- Use the Claude-inspired warm palette from `doc/DESIGN.md`.
- Keep neutrals warm-toned and avoid cool blue-grays.
- Use serif headings and sans-serif UI/body hierarchy per `doc/DESIGN.md`.
- Prefer warm ring shadows, subtle borders, and soft rounded corners.
- Prefer parchment, ivory, warm sand, charcoal, and terracotta roles from `doc/DESIGN.md`.
- Keep the interface editorial, calm, and high-whitespace rather than dense or dashboard-like.

## Renderer boundaries

- Keep privileged logic out of renderer code.
- Use preload APIs for privileged actions.
- Keep business logic out of oversized presentational components when possible.
