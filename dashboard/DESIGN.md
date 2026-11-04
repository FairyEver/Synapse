---
name: HeroUI Default Theme
library: "@heroui/react"
styles: "@heroui/styles"
modes:
  - light
source: "https://github.com/heroui-inc/heroui/blob/v3/packages/styles/themes/default/variables.css"
---

# HeroUI Default Theme

Use this file as the visual implementation contract when building a product with HeroUI v3. It describes the default HeroUI theme for designers and coding agents. The theme CSS remains the source of truth.

## Setup

Install `@heroui/react` and import HeroUI after Tailwind CSS:

```css
@import "tailwindcss";
@import "@heroui/styles";
```

Apply the semantic canvas colors at the application root:

```tsx
<body className="bg-background text-foreground">{children}</body>
```

All application entry documents use `data-theme="light"` and `color-scheme: light`. Do not expose theme settings or react to OS color mode. The dark values below document the upstream library only; the Dashboard does not activate them.

## Template and content boundaries

- Shell, overview, metrics, member tables and forms follow https://template-dashboard.heroui.pro/.
- Histories, logs and search/filter/sort lists follow https://template-4.heroui.pro/transactions.
- Use standard HeroUI components and variants, not a reskinned legacy dashboard component layer.
- Reading/editing content preserves typography, native scrolling and annotation geometry; change outer controls only.

## Design Direction

- Build calm, modern interfaces with a clear content hierarchy.
- Prefer whitespace, typography, and surface levels over decoration.
- Use one strong accent for primary actions and reserve status colors for meaning.
- Compose interfaces from HeroUI components before creating custom primitives.
- Status cards for authorization and client handoff put state in `Card.Content` and actions in `Card.Footer`. Stacked actions use native Button `fullWidth` explicitly, since flex column alignment does not override the default `w-fit`. Keep standard component sizes, semantic variants and natural card height. Handoff copy must not claim client receipt or login success from a protocol-open attempt. Verify actual button/content widths, alignment, spacing, wrapping, keyboard focus and screenshots at desktop and 320px narrow widths across pending, attempted-open, error and retry states.
- Keep interactions accessible, keyboard friendly, and visibly focused.
- Use semantic tokens from the default light theme.
- Let HeroUI Button size its SVGs. Custom icons inside `Dropdown.Item` need explicit `size-4 shrink-0 text-muted` and `aria-hidden`, following the official Dropdown example; Button's `data-icon` does not size menu icons, and Lucide defaults to 24px. Use `Label`/`Description` for item text, native indicators for selection, and a single Section per selection set. Separate file metadata, commands and renderer choices with clear groups; align metadata lines and constrain long filenames. Keep the library's default menu dimensions, radius and shadow. Use `Link.Icon` for link icons, preferring its built-in external arrow for documentation links. Custom SVGs inside `Link.Icon` must fill that slot (`size-full`); do not retain an unrelated intrinsic SVG size. HeroUI does not provide a separate general-purpose icon pack.
- Keep modal, drawer and confirmation content in adjacent `Header`, `Body`, `Footer` slots. HeroUI 3.2.7 supplies their spacing through sibling selectors; do not put fields directly before `Footer` or add a second outer gap. A form wrapping these sections uses `flex min-h-0 flex-1 flex-col`, with field spacing inside `Body`. Reader/lightbox layouts retain their deliberate custom geometry.
- Dialog owns the native outer padding; Header does not supply it. Preserve that padding for standard overlays. Let short content size naturally and long content scroll in Body; reserve the close-button area for arbitrary titles, and let multi-action footers wrap on narrow screens. Verify expanded geometry at both sizes, including empty, short, long and unbroken content.
- On white Card/Surface and overlay backgrounds, explicitly use the documented `secondary` field variant, including grouped inputs, textareas, selectors, checkboxes and radio groups. Controls on the gray page background keep their contrasting default `primary` variant. Determine the actual nearest painted surface, including across component boundaries; do not recolor all fields globally or change action button variants for this purpose. Pass the variant to the documented owner (`InputGroup`, `Select`, `RadioGroup`, `DateField.Group`/`TimeField.Group`), not unrelated wrapper slots. See CLAUDE.md for the mandatory composition and verification rules.

## Colors

Use semantic HeroUI tokens and Tailwind utilities in product code. Raw values are included for design handoff and visual QA only. Do not branch component code by color mode.

| Role | Tailwind utilities | CSS variables | Light | Dark | Purpose |
| --- | --- | --- | --- | --- | --- |
| Canvas | `bg-background text-foreground` | `--background`, `--foreground` | `oklch(0.9702 0 0)`, `oklch(0.2103 0.0059 285.89)` | `oklch(12% 0.005 285.823)`, `oklch(0.9911 0 0)` | Page background and primary content |
| Surface | `bg-surface text-surface-foreground` | `--surface`, `--surface-foreground` | white, foreground | `oklch(0.2103 0.0059 285.89)`, foreground | Cards and non-floating containers |
| Secondary surface | `bg-surface-secondary` | `--surface-secondary` | `oklch(0.9524 0.0013 286.37)` | `oklch(0.257 0.0037 286.14)` | Nested or lower-emphasis regions |
| Tertiary surface | `bg-surface-tertiary` | `--surface-tertiary` | `oklch(0.9373 0.0013 286.37)` | `oklch(0.2721 0.0024 247.91)` | Stronger surface separation |
| Overlay | `bg-overlay text-overlay-foreground` | `--overlay`, `--overlay-foreground` | white, foreground | `oklch(0.2103 0.0059 285.89)`, foreground | Popovers, menus, dialogs, and tooltips |
| Backdrop | `bg-backdrop` | `--backdrop` | black at 50% | black at 60% | Content dimming behind overlays |
| Muted content | `text-muted` | `--muted` | `oklch(0.5517 0.0138 285.94)` | `oklch(70.5% 0.015 286.067)` | Supporting text and secondary icons |
| Neutral action | `bg-default text-default-foreground` | `--default`, `--default-foreground` | `oklch(94% 0.001 286.375)`, eclipse | `oklch(27.4% 0.006 286.033)`, snow | Neutral controls and selected states |
| Accent | `bg-accent text-accent-foreground` | `--accent`, `--accent-foreground` | `oklch(0.6204 0.195 253.83)`, snow | same as light | Primary actions, focus, and emphasis |
| Success | `bg-success text-success-foreground` | `--success`, `--success-foreground` | `oklch(0.7329 0.1935 150.81)`, eclipse | same as light | Positive outcomes and completed states |
| Warning | `bg-warning text-warning-foreground` | `--warning`, `--warning-foreground` | `oklch(0.7819 0.1585 72.33)`, eclipse | `oklch(0.8203 0.1388 76.34)`, eclipse | Caution and attention |
| Danger | `bg-danger text-danger-foreground` | `--danger`, `--danger-foreground` | `oklch(0.6532 0.2328 25.74)`, snow | `oklch(0.594 0.1967 24.63)`, snow | Errors and destructive actions |
| Field | `bg-field text-field-foreground` | `--field-background`, `--field-foreground` | white, eclipse | eclipse, foreground | Inputs and interactive fields |
| Border | `border-border` | `--border` | `oklch(90% 0.004 286.32)` | `oklch(28% 0.006 286.033)` | Component boundaries |
| Separator | `border-separator` | `--separator` | `oklch(92% 0.004 286.32)` | `oklch(25% 0.006 286.033)` | Quiet structural dividers |

Hover, focus, soft, inverse, and secondary or tertiary border colors are derived with `color-mix()`. Use utilities such as `bg-accent-hover`, `bg-accent-soft`, `text-accent-soft-foreground`, `border-border-secondary`, and `border-separator-secondary` instead of recreating those formulas.

## Typography

HeroUI inherits the application's font family and uses Tailwind's type scale. Preserve the component defaults unless the product has its own type system.

- Use concise, descriptive headings in sentence case.
- Use `text-foreground` for primary content and `text-muted` for supporting content.
- Keep body copy readable with a comfortable line height and constrained line length.
- Use tabular numbers for changing metrics, prices, counters, and aligned numeric data.
- Avoid all-caps labels except for short, established conventions.

## Layout

The spacing base is `--spacing: 0.25rem`, giving the system a 4px rhythm through Tailwind spacing utilities.

- Use consistent Tailwind gaps and padding rather than one-off values.
- Keep related controls and content visually grouped.
- Review expanded menus in both regular and compact layouts. Verify computed icon/text sizes, metadata alignment, truncation, selection/hover/focus and viewport bounds; a closed toolbar screenshot is insufficient.
- Constrain wide reading layouts and size containers to their content.
- Avoid doubling parent and child padding in the same direction.
- Align sibling cards, controls, labels, and metrics to shared visual anchors.

## Shapes

The base radius is `--radius: 0.5rem` (8px). The default field radius is `--field-radius: calc(var(--radius) * 1.5)` (12px).

| Utility | Formula | Default value |
| --- | --- | --- |
| `rounded-xs` | `calc(var(--radius) * 0.25)` | 2px |
| `rounded-sm` | `calc(var(--radius) * 0.5)` | 4px |
| `rounded-md` | `calc(var(--radius) * 0.75)` | 6px |
| `rounded-lg` | `calc(var(--radius) * 1)` | 8px |
| `rounded-xl` | `calc(var(--radius) * 1.5)` | 12px |
| `rounded-2xl` | `calc(var(--radius) * 2)` | 16px |
| `rounded-3xl` | `calc(var(--radius) * 3)` | 24px |
| `rounded-4xl` | `calc(var(--radius) * 4)` | 32px |

Use the scale consistently. Inner media and nested surfaces should have a visibly related, usually smaller, radius than their parent.

## Elevation and Depth

- Use `shadow-surface` for cards and raised page content.
- Use `shadow-overlay` for floating layers such as dialogs, menus, and popovers.
- Use `shadow-field` for form controls when the component applies it.
- Dark mode intentionally removes surface and field shadows and gives overlays a subtle inset edge.
- Do not stack custom shadows on HeroUI components that already provide elevation.

## Components

- **Buttons:** Use semantic variants. `primary` is the main action, `secondary` is an alternative, `tertiary` is dismissive or low emphasis, `outline` is a bordered low-emphasis action, `ghost` is an unbordered low-emphasis action, `danger` is destructive, and `danger-soft` is a quieter destructive action. Prefer one primary action per context and reach for an existing variant instead of restyling a button.
- **Document toolbars:** Use `Toolbar` for file actions. Group outline, annotations and messages with native `ButtonGroup + Button`: no gaps, straight internal joins and rounded outer ends, without a simulated rounded background. Keep width and file menus outside the group. Outline and annotations retain `aria-pressed`; messages remains a jump action. Standalone toggles use `ToggleButton`; `ToggleButtonGroup` is for groups consisting entirely of toggles. Do not mix `ToggleButton` into `ButtonGroup` and expect its connected styling to apply.
- **Document toolbar icons:** Outline, annotations and messages use text and counts. Dropdown triggers, including width, renderer selection and more actions, retain their downward indicators. Hiding decorative icons must not hide dropdown indicators or strip icons from expanded menus and annotation-rail controls. Preserve compact grouping, touch targets, scrolling and keyboard behavior. Follow the document-toolbar rules in [CLAUDE.md](./CLAUDE.md) for implementation and acceptance.
- **Cards and surfaces:** Use `Card`, `Surface`, and semantic surface utilities. Create hierarchy with surface levels and spacing before adding borders.
- **Forms:** Use HeroUI field components so background, foreground, placeholder, border, focus, radius, validation, and disabled states stay consistent.
- **Status:** Use success, warning, and danger only for their semantic meanings. Pair color with text or an accessible label.
- **Overlays:** Use HeroUI `Modal`, `Popover`, `Dropdown`, and `Tooltip` components so focus management, dismissal, and keyboard behavior remain accessible.
- **Compound components:** Compose exported parts instead of replacing component behavior with custom divs. Preserve labels, roles, and keyboard interactions.

## Interaction

- Use HeroUI and React Aria states, including `data-hovered`, `data-pressed`, `data-focus-visible`, `data-disabled`, and `data-invalid`.
- Every interactive element needs a visible focus indicator. The default focus color is the accent, with a 2px ring offset.
- The default disabled opacity is `0.5`; disabled controls use a not-allowed cursor.
- Use motion to clarify state changes, not as decoration. Respect reduced-motion preferences.
- Keep icon-only and touch controls large enough to target and give them accessible labels.

## Do

- Use HeroUI components and their documented variants before writing custom primitives.
- Use semantic tokens as implementation handles and raw values only for reference or migration.
- Use the same token in light and dark modes and let CSS resolve the current value.
- Establish hierarchy with content order, spacing, type, and surface level.
- Reserve accent for meaningful emphasis and keep status colors semantic.
- Use separators sparingly; prefer spacing for ordinary grouping.
- Keep active, selected, loading, invalid, and disabled states visible and accessible.

## Don't

- Don't hardcode colors, shadows, radii, or spacing when a HeroUI token or Tailwind utility exists.
- Don't use raw neutral palette classes such as `gray-*` where a semantic surface or content token applies.
- Don't use color alone to communicate state or hierarchy.
- Don't mix unrelated radius, padding, or elevation systems in one view.
- Don't make static content look interactive with hover or pressed effects.
- Don't overuse cards, borders, badges, icons, accent color, or nested heavy surfaces.
- Don't bypass HeroUI interaction behavior with inaccessible custom markup.

## Source of Truth

- Default theme variables: https://github.com/heroui-inc/heroui/blob/v3/packages/styles/themes/default/variables.css
- Tailwind token mappings: https://github.com/heroui-inc/heroui/blob/v3/packages/styles/themes/shared/theme.css
- Component documentation: https://heroui.com/docs/react/components
- Colors: https://heroui.com/docs/react/getting-started/colors
- Theming: https://heroui.com/docs/react/getting-started/theming
- Design principles: https://heroui.com/docs/react/getting-started/design-principles

When this file and the current package disagree, follow the installed HeroUI version and its theme CSS.

## Skill Hub

- The catalog uses one white Surface on the gray page. Entries share that surface, with inset separators and rounding only at the outer edges. Each row has an icon, store name, up to two lines of description, version, and an independent ghost install button. Show the team once in the page header for single-team accounts. For multiple teams, show the team filter and include the team on each entry when browsing all teams.
- Place search first in the filter bar and provide a visible submit button alongside Enter support.
- Load the next page automatically near the bottom of the catalog. Keep existing entries visible during loading and offer an inline retry if the next page fails.
- The detail page places store metadata and actions first, then the two package tabs with read-only package metadata alongside them. Only the latest version appears. On narrow screens, stack the filter controls, allow detail actions to wrap, and place package metadata below the tabs.
