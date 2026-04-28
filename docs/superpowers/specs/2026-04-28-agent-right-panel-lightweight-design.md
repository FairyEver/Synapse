# Agent Right Panel Lightweight Design

Date: 2026-04-28

## Goal

Make the right side of the Agent page feel lighter and closer to the Codex client: white reading surface, fewer visible frames, user messages in a subtle right-aligned bubble, and assistant output rendered without a message bubble.

The change is visual only. It must preserve all existing text, actions, data flow, keyboard behavior, and agent runtime behavior.

## Non-Goals

- Do not change the left session sidebar.
- Do not change agent session selection, timeline loading, live sync, permissions, or send logic.
- Do not copy Codex's exact visual skin.
- Do not introduce custom colors, gradients, inline styles, CSS modules, or a parallel styling system.
- Do not remove user-facing text to make the UI look cleaner.

## Current Context

The right panel currently lives mainly in:

- `desktop/src/modules/agent/index.tsx`
- `desktop/src/modules/agent/components/agent-timeline.tsx`
- `desktop/src/modules/agent/components/agent-message-event.tsx`
- `desktop/src/modules/agent/components/agent-thinking-event.tsx`
- `desktop/src/modules/agent/components/agent-tool-event.tsx`
- `desktop/src/modules/agent/components/agent-run-status.tsx`
- `desktop/src/modules/agent/components/agent-permission-panel.tsx`

The page already uses shadcn/Radix primitives and Tailwind token classes. The current visual weight comes mostly from repeated borders, filled assistant bubbles, compact gaps, and framed collapsible tool/thinking blocks.

## Selected Direction

Use the "Codex lightweight" direction from brainstorming:

- Keep the right panel as a white `bg-background` reading surface.
- Use spacing and alignment as the main hierarchy.
- Keep user messages as right-aligned subtle bubbles.
- Render assistant messages as plain readable content without a bubble background.
- Keep tool, thinking, permission, and composer controls visible, but reduce heavy card-like framing.

## Layout

`AgentModule` keeps the same right-panel structure:

1. Header actions.
2. Error and permission panels.
3. Timeline.
4. Composer.

The layout should feel less boxed by using consistent vertical rhythm instead of extra containers. The right panel should keep enough padding around the timeline and composer so text does not feel crowded. The sidebar and `SidebarContentLayout` behavior stay unchanged.

Spacing rules:

- Use one consistent gap scale for header, alerts, timeline, and composer.
- Give message content enough horizontal padding for readability.
- Keep timeline content from stretching too wide on large screens.
- Do not let text or buttons overlap at narrow widths.

## Messages

User messages:

- Right aligned.
- Subtle token-based surface such as `bg-muted` or `bg-secondary`.
- Text remains `text-foreground` or the matching token foreground.
- Keep the full message content, whitespace, wrapping, local reference buttons, and long path handling.

Assistant messages:

- Left aligned.
- No bubble background and no border.
- Preserve content, whitespace, line breaks, and local reference buttons.
- Use readable line height and a constrained max width.

System or fallback messages should stay subdued but readable. Empty, loading, error, and running text should remain present when it carries useful state.

## Tools And Thinking

Tool calls, tool results, permission request timeline items, and thinking blocks should become light collapsible rows rather than card-like blocks.

Keep existing behavior:

- Failed tool results default to expanded.
- Permission requests default to expanded.
- Collapse behavior still follows the agent display profile.
- Expanded tool bodies still show original input/output text.
- Copy action remains available when body content exists.
- `exitCode` remains visible when provided.

Visual treatment:

- Use a light row with compact title, icon, label, and status badge.
- Prefer whitespace and a single subtle separator over nested borders.
- Expanded content should be readable and not visually louder than assistant text unless it is a failure or pending permission.
- Do not truncate stored content. Preview behavior may still limit visible text when existing logic already does so.

## Composer

The composer remains fixed at the bottom of the right panel and keeps:

- Existing draft state.
- Enter-to-send and Shift-Enter newline behavior.
- Disabled state when no active project exists.
- Icon-only send button with the existing label.
- Existing placeholder text.

The composer should feel like a light input dock:

- White or background-token surface.
- Thin token border.
- Harmonious padding with the timeline.
- Round icon send button.
- No custom colors or inline styles.

## Header Actions

Keep current header functionality:

- Agent title.
- CLI label.
- Active provider badge.
- Active model badge.
- Pending permission count.
- Copy transcript action.
- Command palette action.

The header may reduce visual density by using spacing and lightweight button variants, but it must not hide or remove these actions.

## Product Copy

Do not remove useful interface text as a shortcut to minimalism.

Preserve necessary text for:

- Empty timeline state.
- Runtime processing state.
- Error alerts.
- Permission prompts.
- Tool labels and statuses.
- Composer placeholder.
- Button accessible labels.

Avoid adding new explanatory copy. This is a polish pass, not a product education pass.

## Styling Constraints

Follow the repository design rules:

- Use shadcn/Radix components already in `desktop/src/components/ui/`.
- Use Tailwind layout utilities and theme token classes only.
- No inline `style={{ ... }}`.
- No hex, rgb, hsl, arbitrary color classes, gradients, glow effects, or decorative emoji.
- No nested card treatment.
- Do not add new dependencies.

## Testing

Update focused renderer tests for:

- User messages render right-aligned with a subtle token bubble rather than a primary bubble.
- Assistant messages render without a bubble background.
- Long message content still wraps and preserves whitespace.
- Composer keeps the icon send button, placeholder, transparent textarea, and submit accessibility label.
- Tool event rendering keeps status labels, expanded failed results, permission expansion, body text, copy action, and exit code.

Run relevant tests after implementation:

- Agent component tests.
- Typecheck if the implementation changes types.
- Hard constraints if Electron or IPC code is touched, though this design does not require touching them.

## Acceptance Criteria

- Only the right Agent panel visual surface changes.
- The left session sidebar is unchanged.
- User messages use a subtle right-aligned bubble.
- Assistant messages render without a bubble.
- Tool and thinking events feel lighter while preserving current behavior and text.
- Composer remains functional and visually lighter.
- Header actions remain available.
- Text is not removed for visual minimalism.
- Spacing and padding feel consistent across header, timeline, events, and composer.
- The implementation stays within the existing shadcn/Radix and token-based styling baseline.
