# Drive Preview Toolbar Registry Design

Date: 2026-06-21
Scope: `dashboard/src/features/drive-browser/`, `RELEASE_NOTES_PENDING.md`

## Goal

Unify Drive file preview controls under one host-owned header. The header shows file identity on the left, system actions on the right, and lets the active renderer register renderer-specific toolbar actions that appear before the system actions.

## Current Context

Drive preview currently has three separate control surfaces:

- `DriveFinderFileHeader` renders file identity, download, new-window, history, and renderer selection in Finder mode.
- `DriveRendererFloatingMenu` renders similar system actions in standalone/share reader mode.
- Several renderers render their own top bars:
  - Code renderer shows dirty/read-only state, login, reload, and save.
  - MDXeditor renderer shows the same editing actions.
  - Markdown renderer shows a sticky file header with outline, comments, and comment refresh.
  - Download renderer repeats the download button in the content body.

These surfaces duplicate logic, produce inconsistent hierarchy, and make renderer actions hard to place consistently.

## Product Behavior

### Shared Preview Header

Finder-embedded previews and non-HTML standalone/share previews use the same host-owned preview header.

The header layout is fixed:

```text
[file icon] file name
size / kind / updated time                     [renderer actions] [system actions]
```

Left side:

- File icon.
- File name.
- Size, kind, and updated time.

Right side order:

1. Active renderer contributions.
2. Download.
3. Open in Drive or open in new window, depending on context.
4. History versions when available.
5. Renderer selection when more than one renderer is available.

Renderer contributions always appear before system actions. Finder must not hard-code Code, Markdown, or MDXeditor-specific buttons.

### Floating HTML Controls

HTML direct preview keeps a floating button because a persistent top header would cover the web page being previewed. The floating menu consumes the same system action definitions and the same renderer contribution model, but presents them inside a dropdown.

The floating button is used when the selected renderer is `iframe`. Other renderers use the shared preview header.

### Renderer Contributions

Renderers can register toolbar items with the preview host. Registration is local to the mounted renderer and is cleared automatically when the renderer unmounts or the selected renderer changes.

Supported contribution types:

- `status`: short state text such as `未保存`, `已同步`, or `只读`.
- `button`: compact action button with label, optional icon, variant, disabled/loading state, and handler or link.
- `toggle`: active/inactive button for local renderer panels such as outline and comments.
- `menu`: dropdown trigger with renderer-owned menu items.

Renderer contribution examples:

- Code renderer registers status, login when required, reload, and save.
- MDXeditor renderer registers status, login when required, reload, and save. The MDXEditor editing toolbar remains inside the editor because it edits Markdown structure, not file preview chrome.
- Markdown renderer registers outline toggle, comments toggle, and comment refresh. The outline rail, comment rail, and pending comment form remain inside the renderer body.
- Image and iframe renderers usually register nothing.
- Download renderer should not repeat the download action in the body when the shared header or floating menu already exposes download.

## Architecture

### Host-Owned Chrome

Create a small preview chrome layer under `dashboard/src/features/drive-browser/`:

```text
renderers/
  drive-renderer-shell.tsx
  drive-renderer-toolbar-context.tsx
  drive-preview-actions.ts
  drive-preview-header.tsx
  drive-preview-floating-menu.tsx
```

The exact filenames can be adjusted during implementation, but responsibilities should stay separate.

`DriveRendererShell` owns:

- selected renderer state when uncontrolled,
- renderer option selection,
- toolbar contribution state,
- choosing `toolbar` or `floating` chrome mode,
- rendering the active renderer inside the contribution provider.

`DrivePreviewHeader` owns:

- file identity display,
- renderer contribution rendering,
- system action rendering,
- versions dialog trigger,
- renderer selection menu.

`DrivePreviewFloatingMenu` owns only floating position and dropdown presentation. It must not duplicate action decisions.

`drive-preview-actions.ts` owns pure helpers:

- file identity view model,
- system action view model,
- open-in-drive URL,
- open-in-new-window URL,
- version item id,
- renderer selector options.

### Finder Responsibilities

Finder owns the preview region, but not renderer-specific control logic.

Finder should render `DriveRendererShell` for the selected file and let `DriveRendererShell` render the shared preview header when the selected renderer is not `iframe`.

Finder folder toolbar remains separate because it operates on directories, not the current file renderer.

### Renderer Responsibilities

Renderer components only render file content and register optional contributions.

Renderers must not render a file-level top bar with `border-b` for save, reload, file name, outline, comments, or system actions. They can still render content-internal panels and editor-native toolbars when those controls belong to the content editor itself.

## UI Rules

- Use existing shadcn/Radix components and Tailwind token classes.
- Do not add custom colors, gradients, glow, decorative shadows, nested cards, or one-off CSS.
- Keep copy short and operational.
- Use lucide icons already used in the feature.
- Do not add explanatory helper text to the header.
- Keep controls compact and stable at 32px density.
- Renderer contribution labels must not duplicate adjacent system labels.

## Data Flow

The existing `DriveBrowserSnapshotDto` remains the only server data source. No server DTO or API change is required.

Flow:

```text
DriveBrowserSnapshotDto
  -> DriveRendererShell
    -> build system actions
    -> provide toolbar registration context
    -> render header or floating menu
    -> render selected renderer
      -> renderer registers contributions
      -> host re-renders chrome
```

Contribution registration should be keyed by renderer id or caller-provided stable ids so repeated renders replace existing items instead of appending duplicates.

## Current Renderer Migration

### Code Renderer

Move the renderer top bar into contributions:

- status: `未保存`, `已同步`, or `只读`.
- login button when `edit.reason === "login_required"`.
- reload button when editable.
- save button when editable.

Keep conflict dialog, Monaco editor, truncated warning, and error display in the renderer.

### MDXeditor Renderer

Move file-level edit status and save/reload/login actions into contributions.

Keep the MDXEditor native editing toolbar inside the editor because it controls Markdown formatting and block insertion.

### Markdown Renderer

Move outline toggle, comments toggle, and refresh comments into contributions.

Remove the sticky file header. Keep:

- pending comment form,
- outline rail,
- rendered Markdown body,
- comments rail,
- selection/comment creation logic.

### Download Renderer

Use the shared header download action. The renderer body should only show the minimal unavailable-preview state.

### Image Renderer

No contribution needed.

### Iframe Renderer

Use floating menu mode. No persistent header.

## Testing

Add focused tests for:

- non-iframe standalone Markdown files render the shared header and do not render the floating file button;
- iframe HTML files render the floating button and do not render the shared header;
- Finder file previews and standalone file previews share the same system action labels and renderer selector behavior;
- Code renderer registers save/reload/status actions into the shared header;
- MDXeditor registers save/reload/status actions while preserving the MDXEditor native toolbar plugin;
- Markdown renderer registers outline/comments/refresh actions and no longer renders its own sticky file header;
- renderer contributions are cleared when switching renderer options;
- download-only renderer does not duplicate the download button in the content body.

## Release Note

Add a pending release note explaining that Drive file previews now use one consistent preview toolbar, with renderer-specific actions such as save, reload, outline, and comments appearing in the same header as file actions.
