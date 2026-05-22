# Content Editor Windows Design

## Goal

Redesign Rule, Skill, and Prompt creation/editing so users work in dedicated editor windows instead of page-level modal dialogs.

The new experience must solve the current editing pain:

- Details windows should not remain visible while editing that same content.
- Long text fields need editor-like space instead of being squeezed into a form dialog.
- Skill attachments should be managed without competing with the main instructions field.
- Rule and Prompt editing should make the final Markdown easier to review while writing.

## Scope

In scope:

- Rule, Skill, and Prompt creation from the main content browser.
- Rule, Skill, and Prompt editing from detail windows.
- Existing external create/edit-overwrite requests for Rule and Skill.
- New dedicated renderer page for content editor windows.
- Content window URL parsing/building for detail, create, and edit modes.
- Main-process content window management and singleton behavior.
- Save, conflict, initialization failure, and close/discard behavior.
- Focused tests for window routing, editor save behavior, and content change notifications.

Out of scope:

- Changing content storage format.
- Reworking content detail page visual design beyond the edit entry behavior.
- Adding a rich Markdown editor dependency.
- Adding prompt execution or variable runtime features to the editor.
- Changing built-in content read-only rules.

## Product Behavior

### Main Window Create

When the user clicks create in the main Rule, Skill, or Prompt browser:

1. The main window stays open.
2. A dedicated create window opens for that content type.
3. Only one create window may exist for each content type.
4. Repeating the same create action focuses the existing create window.
5. Saving successfully closes the create window and refreshes the main window list.
6. The newly created item is not automatically opened in a detail window.

### Detail Window Edit

When the user clicks edit in a content detail window:

1. The app requests a dedicated edit window.
2. If the edit window opens or focuses successfully, the current detail window closes.
3. If the edit window fails to initialize, the detail window remains visible and shows an error toast.
4. Only one edit window may exist for the same `contentType:id`.
5. Repeating edit for the same content focuses the existing edit window.
6. Saving successfully closes the edit window, then opens a detail window for the latest version.

### Save And Conflict

Save behavior:

- Create save success: close editor window; refresh list through the content changed event.
- Edit save success from detail: open latest detail window; close editor window.
- Save conflict: keep editor window open and show a concise conflict message.
- Save failure: keep editor window open and show the error.
- Save in progress: disable duplicate submit.

### Close And Discard

Closing an editor with unsaved changes opens the existing discard confirmation flow adapted for a window.

If there are no unsaved changes, closing the window just closes it.

## Window Model

Extend content windows from a single detail shape to a typed model:

```ts
type SynapseContentWindowRequest =
  | {
      kind: "detail"
      contentType: SynapseContentType
      id: string
      viewMode: SynapseContentViewMode
    }
  | {
      kind: "create"
      contentType: SynapseContentType
      initialValue?: SynapseCreateContentPayload | null
      notices?: ContentCreateNotice[]
      sourceLabel?: string | null
    }
  | {
      kind: "edit"
      contentType: SynapseContentType
      id: string
      origin: "detail" | "external"
      prefill?: EditOverwriteRulePrefill | EditOverwriteSkillPrefill | null
      notices?: ContentCreateNotice[]
      sourceLabel?: string | null
    }
```

The implementation may use a payload type distinct from the parsed request type if binary attachment data needs IPC-safe handling. Large or binary initialization payloads should be passed through IPC-managed state rather than encoded into the window URL.

Window keys:

- Detail: `detail:${contentType}:${id}`
- Edit: `edit:${contentType}:${id}`
- Create: `create:${contentType}`

Window methods:

- Keep `openDetailWindow(payload)` for existing callers.
- Add `openCreateWindow(payload)`.
- Add `openEditWindow(payload)`.

The service returns only after the target window has loaded and the editor bootstrap has acknowledged the request. This matters for the detail edit flow because the detail window closes only after successful editor initialization.

## Editor Layout

Use a shared full-window editor shell for Rule, Skill, and Prompt.

The editor uses shadcn/Radix components and existing theme tokens only. It must not introduce custom colors, gradients, nested cards, page-specific CSS modules, or inline styling beyond unavoidable dynamic values.

### Frame

The window is divided into:

- Left column: metadata.
- Center column: main content editor.
- Right column: auxiliary panel.
- Bottom action bar: discard/cancel, save, and save error.

The layout should be dense, stable, and app-like. It should avoid explanatory copy that does not help the user complete the current edit.

### Left Column

Contains compact form controls:

- Title.
- Name for Rule and Skill.
- Category.
- Description.
- Usage for Skill.
- Appearance controls.

The column scrolls independently if needed.

### Center Column

The center column is the primary working area.

- Rule: body field labeled `正文`.
- Prompt: body field labeled `正文`.
- Skill: main instructions field labeled `主说明`.

The text area fills available height. The design should keep labels and errors visible without shrinking the writing area unnecessarily.

### Right Column

The right column changes by content type:

- Skill: attachment manager is the primary panel.
- Rule: Markdown preview is the primary panel.
- Prompt: Markdown preview is the primary panel. If the body contains `{{...}}` tokens, the panel may list detected placeholders without adding execution or runtime variable features.

All validation summaries stay brief and appear only when needed.

### Window Sizes

Recommended defaults:

- Rule and Prompt: `1120 x 760`, minimum `960 x 640`.
- Skill: `1280 x 820`, minimum `1120 x 680`.

Skill uses a larger default because attachment management needs more horizontal and vertical room.

## Component Design

Reuse current form behavior instead of rewriting validation.

Keep:

- `useContentCreateForm`.
- Existing validation and normalization functions.
- `useContentIconImage`.
- Skill attachment collection and serialization helpers.
- Existing duplicate warning behavior.
- Existing discard confirmation semantics.

Refactor:

- Extract reusable form sections from `RuleCreateDialog`, `PromptCreateDialog`, and `SkillCreateDialog`.
- Create a shared `ContentEditorWindowPage` for dedicated create/edit windows.
- Keep existing dialog components temporarily if needed for incremental migration, but route main create and detail edit to editor windows.

Avoid:

- A new rich text editor dependency.
- Duplicating validation in window-specific code.
- Moving Electron or filesystem responsibilities into React components.

## Data Flow

### Create Flow

1. Main content browser calls `openCreateWindow`.
2. Editor window initializes form from empty/default payload or external prefill.
3. User saves.
4. Editor calls content `create`.
5. Main process emits `content.changed` on saved result.
6. Main window repository manager receives the event and refreshes the matching list.
7. Editor closes itself.

### Edit Flow From Detail

1. Detail window calls `openEditWindow`.
2. Main process creates or focuses the edit window.
3. On success, detail window closes.
4. Editor window reads current detail and builds the form initial value.
5. User saves.
6. Editor calls content `update` with `baseHistoryDirname`.
7. Main process emits `content.changed` on saved result.
8. Editor opens the latest detail window.
9. Editor closes itself after the detail window opens.

### Initialization Failure

If edit window creation or initialization fails:

- The detail window remains open.
- The user sees a concise toast.
- The failure is logged through the renderer logger.

## Content Changed Event

The existing main window list refresh depends on `content.changed`.

Because dedicated editor windows save outside the main renderer's repository manager, create and update IPC paths must emit `content.changed` after saved mutations. Conflict results must not emit the event.

The event payload should include:

- `contentType`
- `contentId`
- `operation`
- `latestHistoryDirname`
- `modifiedAt`

## Error Handling

- Read-only or built-in content cannot open an editor.
- Missing content in edit mode shows an error state in the editor window.
- Save conflict keeps the editor open.
- Attachment collection errors stay in the Skill attachment panel.
- Preload or bridge errors show a concise failure message and log details.
- Empty `catch {}` blocks are not allowed.

## Tests

Add or update focused tests for:

- Content window URL build/parse for `detail`, `create`, and `edit`.
- Content window service singleton keys for detail, create, and edit.
- Detail edit flow only closes the detail window after `openEditWindow` succeeds.
- Create save success closes editor and relies on `content.changed` to refresh lists.
- Edit save success opens latest detail window and closes editor.
- Conflict keeps editor open.
- IPC create/update saved results emit `content.changed`; conflict results do not.
- Skill attachment behavior still accepts files/folders, rejects invalid files, and serializes payloads correctly.

## Acceptance Criteria

- Rule, Skill, and Prompt create actions open dedicated windows from the main browser.
- Rule, Skill, and Prompt edit actions open dedicated windows from detail windows.
- Detail windows are not visible while their content is being edited.
- Edit initialization failure leaves the detail window open and shows a toast.
- Saving edited content returns the user to the latest detail window.
- Saving newly created content refreshes the main list without opening detail.
- Each content type has at most one create window.
- Each content item has at most one edit window.
- Editor layouts follow the shared shadcn/Radix visual baseline and use existing theme tokens.
- No development server, browser preview, or runtime inspection is required for verification unless explicitly requested.
