# Workflow Prompt Shortcuts Design

## Goal

Upgrade the workflow prompt instruction input so users can quickly insert bound variables and Claude Code global skills without crowding the node configuration panel.

The target interaction is:

- Typing `@` opens variable suggestions. Selecting `AAA输出` inserts `{{AAA输出}}`.
- Typing `/` opens Skill suggestions. Selecting `review-code` inserts `skill: review-code`.
- The editor also exposes two small entry buttons, `@ 变量` and `/ Skill`, for discoverability.

## Current Context

Prompt-like workflow fields use `desktop/workflow-nodes/prompt-editor.tsx`.

That component currently renders a shadcn `Textarea`, lists named variable bindings as bottom badges, and inserts `{{变量名}}` when a badge is clicked. It is reused by prompt, switch, and end nodes.

The app already depends on CodeMirror through `@uiw/react-codemirror`, and `desktop/action-packages/builtin/http-request/code-json-editor.tsx` already uses it. CodeMirror 6 supports custom completion sources and keyboard navigation for completion lists.

Global Claude Code skills are already available through the existing `editorScan.scanAll()` bridge. The Claude Code global entry has `editorId: "claude-code"` and includes `skills`.

## Product Design

Replace the prompt editor textarea with a plain-text CodeMirror editor configured for prompt writing, not for a programming language.

The visible surface should stay compact:

- Main editor area for the instruction text.
- Bottom bar with two explicit shortcut buttons and the character count.
- Completion menu appears only while choosing a variable or Skill.

The bottom bar must not list every Skill. Variables may still be reachable through the `@ 变量` button instead of permanently rendering all variable chips. This keeps the panel stable when a user has many global Skills.

## Completion Behavior

Variable completion:

- Trigger: `@`
- Source: current node `variables` prop after filtering out blank names.
- Inserted text: `{{name}}`
- Menu label: variable name.

Skill completion:

- Trigger: `/`
- Source: Claude Code global skills from `editorScan.scanAll()`.
- Inserted text: `skill: skill-name`
- Menu label: Skill name.
- Duplicate Skill names should be de-duplicated by name in the editor suggestion list.

Filtering should rely on CodeMirror's completion filtering where possible. Completion should stay open while the user continues typing after `@` or `/`.

The `@ 变量` and `/ Skill` buttons should focus the editor, insert the trigger character at the current cursor, and open completion. If the user has selected text, the trigger replaces the selection.

## Data Flow

`PromptEditor` remains the shared component for prompt-like workflow fields.

It should:

- Receive `value`, `onChange`, `onBlur`, `variables`, `placeholder`, and `rows` as it does today.
- Load Claude Code global skills through a focused hook or helper that calls `window.synapse.editorScan.scanAll()`.
- Derive completion options from local variables and loaded skills.
- Emit the same plain string value through `onChange`.

No workflow definition schema change is needed. No runtime interpolation change is needed. `{{变量}}` remains the workflow variable syntax. `skill: review-code` is plain prompt text consumed by Claude Code.

## UI Constraints

Follow the Synapse shadcn/Radix baseline:

- Use existing shadcn `Button` and `Badge`-like semantics only where needed.
- Use theme tokens and Tailwind layout utilities.
- Do not add hard-coded colors, gradients, custom CSS modules, or inline component styles.
- Do not add explanatory product copy inside the panel beyond labels needed for operation.

The CodeMirror surface should visually align with existing shadcn inputs using tokenized border/background/ring classes or a small local theme extension.

## Error And Empty States

If skill scanning fails, the prompt editor still works for variables. The failure should be logged with the renderer logger, not shown as persistent panel copy.

If there are no variables, `@` should show no variable options. If there are no Claude Code global skills, `/` should show no Skill options. The buttons may remain visible because they teach the shortcut, but they should not create a noisy empty panel.

## Testing

Add focused tests for:

- `@` variable completion inserts `{{变量名}}`.
- `/` Skill completion inserts `skill: skill-name`.
- Skill suggestions are limited to the Claude Code global scan entry.
- Blank variable names and duplicate Skill names are filtered out.

Prefer testing pure completion helpers if CodeMirror DOM interaction is heavy in jsdom, and add one component-level test for visible controls if practical.

## Out Of Scope

- Adding a new workflow placeholder syntax.
- Changing workflow runner interpolation.
- Listing project-local Skills.
- Syntax highlighting, linting, slash command execution, or Skill validation at run time.
- Reworking the variable binding editor.
