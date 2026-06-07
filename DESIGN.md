---
name: Synapse
description: Cross-editor AI capability management tool
colors:
  background: "oklch(1 0 0)"
  foreground: "oklch(0.145 0 0)"
  card: "oklch(1 0 0)"
  card-foreground: "oklch(0.145 0 0)"
  popover: "oklch(1 0 0)"
  popover-foreground: "oklch(0.145 0 0)"
  primary: "oklch(0.205 0 0)"
  primary-foreground: "oklch(0.985 0 0)"
  secondary: "oklch(0.97 0 0)"
  secondary-foreground: "oklch(0.205 0 0)"
  muted: "oklch(0.97 0 0)"
  muted-foreground: "oklch(0.556 0 0)"
  accent: "oklch(0.97 0 0)"
  accent-foreground: "oklch(0.205 0 0)"
  destructive: "oklch(0.577 0.245 27.325)"
  border: "oklch(0.922 0 0)"
  input: "oklch(0.922 0 0)"
  ring: "oklch(0.708 0 0)"
  surface: "oklch(0.965 0 0)"
  sidebar: "oklch(0.985 0 0)"
  sidebar-foreground: "oklch(0.145 0 0)"
  chart-1: "oklch(0.58 0.13 248)"
  chart-2: "oklch(0.64 0.1 198)"
  chart-3: "oklch(0.66 0.1 154)"
  chart-4: "oklch(0.7 0.11 78)"
  chart-5: "oklch(0.61 0.11 304)"
typography:
  display:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0"
  headline:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0"
  title:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.375
    letterSpacing: "0"
  body:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "0"
rounded:
  sm: "calc(var(--radius) * 0.6)"
  md: "calc(var(--radius) * 0.8)"
  lg: "var(--radius)"
  xl: "calc(var(--radius) * 1.4)"
  full: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    height: "2rem"
    padding: "0 0.625rem"
    typography: "{typography.label}"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "2rem"
    padding: "0 0.625rem"
    typography: "{typography.label}"
  card-default:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.lg}"
    padding: "1rem"
    typography: "{typography.body}"
  input-default:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "2rem"
    padding: "0.25rem 0.625rem"
    typography: "{typography.body}"
---

# Design System: Synapse

## 1. Overview

**Creative North Star: "Precision Workbench"**

Synapse is a dense product interface for people managing local AI capabilities, editor integrations, Agent sessions, workflows, data, diagnostics, and usage. The system should feel like a precise workbench: organized surfaces, obvious controls, visible state, and no unnecessary spectacle.

The visual baseline is shadcn/ui `radix-nova` on Radix primitives, Geist Variable, Tailwind CSS, and OKLCH CSS variables. Product restraint is the rule. UI should stay close to the existing component vocabulary unless a task explicitly changes the product direction.

It explicitly rejects marketing-page treatment inside the app: no generic AI gradients, decorative glow, emoji headings, over-rounded showpiece cards, ornamental motion, or explanatory UI copy that exposes implementation details.

**Key Characteristics:**
- Compact product density with 32px default controls.
- Neutral surfaces, semantic state color, and chart color only where data needs it.
- Familiar shadcn/Radix controls with consistent hover, focus, active, disabled, and invalid states.
- Layering through token backgrounds, 1px rings, separators, and focused state, not decorative shadows.
- Short operational copy written for users who are already in a task.

## 2. Colors

The palette is a neutral work surface: black, white, gray, semantic destructive, and a small chart vocabulary. OKLCH tokens in `desktop/src/styles/globals.css` are canonical.

### Primary
- **Workbench Ink** (`oklch(0.205 0 0)`): primary actions, selected high-emphasis controls, and the strongest foreground-on-light role.
- **Ink Inverse** (`oklch(0.985 0 0)`): text and icons on primary surfaces.

### Secondary
- **Quiet Control Surface** (`oklch(0.97 0 0)`): secondary buttons, active tabs, muted tool areas, and selected rows where emphasis should be present but calm.
- **Control Ink** (`oklch(0.205 0 0)`): foreground for secondary and accent surfaces.

### Tertiary
- **Operational Charts** (`oklch(0.58 0.13 248)`, `oklch(0.64 0.1 198)`, `oklch(0.66 0.1 154)`, `oklch(0.7 0.11 78)`, `oklch(0.61 0.11 304)`): reserved for usage analysis, reports, and data comparison. Do not turn these into decorative page accents.
- **Destructive Red** (`oklch(0.577 0.245 27.325)`): destructive actions, invalid fields, and error states only.

### Neutral
- **Canvas** (`oklch(1 0 0)`): main content background.
- **Primary Text** (`oklch(0.145 0 0)`): body copy, labels, table text, and primary icons.
- **Muted Text** (`oklch(0.556 0 0)`): secondary metadata, descriptions, captions, and placeholders.
- **Divider Line** (`oklch(0.922 0 0)`): borders, input outlines, table row separators, and low-emphasis structural lines.
- **Soft Surface** (`oklch(0.965 0 0)`): app shell surface and background layer behind content.

### Named Rules

**The Token-Only Rule.** Use theme tokens and shadcn variant classes. Do not introduce hex, rgb, hsl, Tailwind arbitrary colors, or one-off page palettes.

**The Accent Rarity Rule.** Primary and chart colors serve action, selection, state, or data. They are not decoration.

## 3. Typography

**Display Font:** Geist Variable, sans-serif  
**Body Font:** Geist Variable, sans-serif  
**Label/Mono Font:** Geist Variable for UI labels; use a mono face only in code or log-specific contexts.

**Character:** The type system is compact, neutral, and utilitarian. Weight and spacing carry hierarchy; product screens do not need editorial display typography.

### Hierarchy
- **Display** (600, `1.5rem`, 1.2): rare page-level headings or major empty-state headings. Keep it fixed, not fluid.
- **Headline** (600, `1.25rem`, 1.25): section-level headings where a module needs a clear top anchor.
- **Title** (500, `1rem`, 1.375): card titles, dialog titles, panel headers, and compact module headings.
- **Body** (400, `0.875rem`, 1.5): default UI text, tables, descriptions, and dense product content.
- **Label** (500, `0.875rem`, 1.25): buttons, field labels, tabs, menu items, and sidebar rows.

### Named Rules

**The Fixed Scale Rule.** Do not use viewport-scaled type in product UI. Synapse is used in app windows and panels, where stable size beats theatrical scale.

**The No-Voice-Over Rule.** UI text should name the thing, action, state, or error. Do not add feature-introduction paragraphs or implementation explanations.

## 4. Elevation

Synapse is flat by default. Depth comes from background layers, borders, rings, selected states, separators, and focus treatments. Shadows are exceptional and should usually appear only where the existing shadcn component already uses them, such as active tab triggers or floating sidebar variants.

### Shadow Vocabulary
- **Tab Lift** (`shadow-sm`): active segmented tab affordance in the default tabs variant.
- **Floating Sidebar Lift** (`shadow-sm` plus `ring-sidebar-border`): floating sidebar variant only.
- **Dialog Layer** (`ring-1 ring-foreground/10` with overlay): modal depth is structural, not decorative.

### Named Rules

**The Flat-By-Default Rule.** A surface at rest uses a token background plus a 1px ring or border. Do not combine decorative shadow, border, and background to manufacture extra hierarchy.

## 5. Components

### Buttons
- **Shape:** `rounded-lg` from `--radius` (`0.625rem` base) with full icon alignment through lucide icons.
- **Primary:** `bg-primary text-primary-foreground`, 32px default height, compact horizontal padding, `text-sm font-medium`.
- **Hover / Focus:** color changes stay inside the variant; focus uses `focus-visible:border-ring` and a 3px ring at `ring/50`.
- **Secondary / Ghost / Outline:** use shadcn variants. Outline remains `border-border bg-background`; ghost is hover-only emphasis; destructive is tinted and text-led, not full warning fill.

### Chips
- **Style:** `Badge` uses 20px height, pill radius, `text-xs font-medium`, and token variants.
- **State:** badges are labels or compact state markers. They should not become decorative callouts.

### Cards / Containers
- **Corner Style:** `rounded-lg`.
- **Background:** `bg-card text-card-foreground`.
- **Shadow Strategy:** no default shadow. Use `ring-1 ring-foreground/10` for structure.
- **Border:** prefer ring/border token layers over bespoke styling.
- **Internal Padding:** default vertical padding is `1rem`; header and content use `1rem` horizontal padding, with small cards reducing to `0.75rem`.

### Inputs / Fields
- **Style:** 32px height, `rounded-lg`, `border-input`, transparent background in light mode, input tint in dark mode.
- **Focus:** `border-ring` plus 3px token ring.
- **Error / Disabled:** invalid uses destructive border and ring; disabled reduces opacity and interaction, and may tint the input token.

### Navigation
- **Style:** sidebars and module lists are dense, token-backed, and icon-friendly. Active items use secondary surfaces. Hover states use muted surfaces.
- **Typography:** navigation labels use `text-sm font-medium`; descriptions use `text-xs text-muted-foreground`.
- **Responsive Treatment:** desktop sidebars can collapse; mobile sidebars use Sheet. Do not invent a parallel navigation system for single modules.

### Tables
- **Style:** compact, border-separated, horizontal-scroll safe.
- **Rows:** hover uses `bg-muted/50`; selected state uses `bg-muted`.
- **Alignment:** text is left by default; numeric columns should be right-aligned at the column definition level.

### Dialogs
- **Style:** centered, `rounded-lg`, `bg-popover`, 1px foreground ring, short headers, and footer separated by muted background.
- **Motion:** 150 to 200ms state transitions are acceptable. Motion should reflect open, close, focus, or feedback.

## 6. Do's and Don'ts

### Do:
- **Do** start with existing shadcn/Radix primitives in `desktop/src/components/ui/`.
- **Do** use token classes such as `bg-background`, `text-foreground`, `bg-card`, `border-border`, `text-muted-foreground`, and `ring-ring/50`.
- **Do** keep product density compact, especially in sidebars, tables, settings, and diagnostics.
- **Do** use lucide icons in icon buttons and keep icon/text alignment centered.
- **Do** write empty, error, loading, and disabled states with short operational copy.
- **Do** keep sensitive operations visually explicit through confirmation, state, and audit-friendly wording.

### Don't:
- **Don't** make Synapse look like a marketing landing page inside the app.
- **Don't** use generic AI gradients, decorative glow, emoji headings, over-rounded showpiece cards, or ornamental motion.
- **Don't** introduce hex, rgb, hsl, Tailwind arbitrary colors, custom page palettes, styled components, or one-off CSS modules for ordinary UI.
- **Don't** nest cards inside cards or stack repeated dividers to create hierarchy.
- **Don't** put business logic, fetch chains, or routing side effects inline inside JSX.
- **Don't** write UI copy that explains implementation details, future plans, or agent self-description.
