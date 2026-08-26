# Drive MDXeditor Renderer Design

Date: 2026-06-18
Scope: `dashboard/`, `server/`, `shared/`, `docs/`

## Goal

Add a Drive browser renderer named `MDXeditor` for Markdown files. The renderer uses the open-source `@mdxeditor/editor` package and lets users edit Drive `.md` and `.mdx` files through the existing online text editing capability.

This is an adapter for the current Drive render pipeline. It is not a new desktop editor window, not a new Drive save API, and not a replacement for the existing rendered Markdown preview.

## Confirmed Product Decisions

- The renderer name is `MDXeditor`.
- `@mdxeditor/editor` should use the latest npm version available during design: `4.0.3`.
- Opening a Markdown file in the Drive browser should default to the `MDXeditor` renderer.
- Saving is manual. There is no auto-save in the first version.
- The existing rendered Markdown preview remains available as a separate renderer option.
- The existing Monaco code renderer remains available as a separate renderer option.
- Desktop Drive file list behavior does not change. The desktop preview action still opens the Drive browser URL.
- The implementation lives in the dashboard Drive browser renderer layer.
- The existing Drive text save flow remains authoritative: `preview.text`, `edit.currentVersionId`, `editContext.saveText(...)`, reload, and version conflict handling.
- `.mdx` files should be recognized as Markdown-compatible Drive browser files.
- Ordinary `.md` and `.markdown` files should treat the `<=` comparison operator as CommonMark text before MDX JSX parsing. `.mdx` files keep strict MDX parsing.
- `.mdx` files with JSX, attributes, expressions, and MDX comments may use rich mode. Files with top-level MDX ESM `import` or `export` stay in source mode because MDXEditor does not round-trip arbitrary ESM declarations.
- CommonMark files containing HTML comments outside code spans or fenced code stay in source mode because MDXEditor does not round-trip those comments.
- Ordered lists must preserve their explicit starting number across rich editing and source serialization.
- Ordered lists must use structure-derived hierarchical decimal markers in both rich editing and rendered preview: top-level items render as `1.`, `2.`, while nested ordered items render as `2.1`, `2.2`, `2.2.1`. Unordered ancestors do not add a numbering level, explicit `start` values remain authoritative, and generated markers must never enter Markdown serialization.
- In MDXEditor tables, `Enter` keeps the existing next-row cell navigation and `Shift + Enter` inserts an inline `<br />` break in the current cell.

## Non-Goals

- Do not build a separate desktop Markdown editor.
- Do not add a new Drive file save endpoint.
- Do not change the Drive item row actions in the desktop app.
- Do not replace or remove the current rendered Markdown preview.
- Do not remove the Monaco code renderer for Markdown files.
- Do not add image upload, attachment insertion, or Drive asset insertion inside MDXEditor in the first version.
- Do not implement frontmatter-specific forms.
- Do not implement diff views.
- Do not implement collaborative editing.
- Do not implement auto-save.
- Do not add custom colors, decorative styling, or a parallel visual system around MDXEditor.

## Current Drive Browser Render Pipeline

Desktop Drive currently opens public app URLs for preview:

```text
desktop Drive list
  └─ preview action
      └─ getDriveItemPreviewUrl(...)
          └─ shell.openExternal(url)
              └─ dashboard Drive browser
```

The actual file rendering happens in the server and dashboard:

```text
server DriveService
  └─ buildBrowserPreview(...)
      ├─ resolves preview.kind
      ├─ reads preview.text for text-like files
      ├─ renders preview.html and outline for markdown
      └─ builds edit capability

dashboard DriveBrowserPage
  └─ useDriveBrowser(...)
      └─ returns snapshot + editContext

dashboard DriveRendererShell
  └─ getDriveRendererOptions(snapshot)
      └─ DriveRendererContent selected renderer
```

Markdown files already have:

```text
preview.kind = "markdown"
preview.text = full markdown text
preview.html = server-rendered HTML preview
preview.outline = heading outline
edit.editorKind = "text" when editable
edit.currentVersionId = current version guard
```

The new work should consume this existing data rather than adding a parallel model.

## Target Render Pipeline

For `.md`, `.markdown`, `.mdx`, `text/markdown`, and `text/x-markdown` files:

```text
DriveBrowserSnapshotDto
  ├─ current.previewKind = "markdown"
  ├─ preview.kind = "markdown"
  ├─ preview.text = source Markdown or MDX text
  ├─ preview.html = existing rendered preview
  └─ edit = existing text edit capability
      │
      ▼
renderer options
  ├─ MDXeditor
  ├─ 预览
  └─ 代码
```

`MDXeditor` is the default renderer for Markdown-compatible files.

## Renderer Registry

Add a renderer id:

```text
DriveRendererId =
  | "mdxeditor"
  | "markdown"
  | "code"
  | "image"
  | "iframe"
  | "download"
```

Renderer labels:

```text
mdxeditor  → MDXeditor
markdown   → 预览
code       → 代码
```

Markdown renderer options become:

```text
preview.kind === "markdown"
  → [MDXeditor, 预览, 代码]
```

Non-Markdown renderer options are unchanged.

## MDXeditor Renderer Component

Add a dashboard component:

```text
dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.tsx
```

Responsibilities:

- Import the official MDXEditor component and required plugins from `@mdxeditor/editor`.
- Import the official stylesheet once through the component module or the dashboard style entry.
- Initialize editor content from `preview.text ?? ""`.
- Track local `value`, `dirty`, `error`, and `conflictOpen` state.
- Use `edit.canEdit`, `edit.currentVersionId`, and `editContext` to decide whether editing is enabled.
- Save with `editContext.saveText({ text: value, baseVersionId: edit.currentVersionId })`.
- Reload with `editContext.reload()`.
- Preserve the existing conflict behavior used by the Monaco code renderer.
- Render read-only content when edit capability is unavailable.

Suggested structure:

```text
DriveMdxEditorRenderer
├─ status/action bar
│  ├─ 只读 / 已同步 / 未保存
│  ├─ 登录后编辑 when edit.reason === "login_required"
│  ├─ 重新加载
│  └─ 保存
├─ MDXEditor toolbar
└─ MDXEditor body
```

The component should stay full-height inside `DriveRendererShell`:

```text
className = "flex h-full min-h-0 w-full flex-col overflow-hidden"
```

The editor host should take the remaining height:

```text
className = "min-h-0 flex-1 overflow-auto"
```

## Editing Behavior

Initial load:

```text
initialText = preview.text ?? ""
value = initialText
dirty = false
```

On editor change:

```text
value = nextMarkdown
dirty = nextMarkdown !== initialText
```

On save:

```text
if edit.canEdit && edit.currentVersionId && editContext:
  editContext.saveText({
    text: value,
    baseVersionId: edit.currentVersionId
  })
```

Save success:

```text
dirty = false
useDriveBrowser reloads snapshot through the existing save mutation
```

Save conflict:

```text
if ApiError.status === 409:
  show conflict dialog
  keep local edited value
```

Reload:

```text
editContext.reload()
value = latest preview.text
dirty = false
conflictOpen = false
```

Read-only:

```text
edit.canEdit is false
  → MDXEditor readOnly
  → no save button
```

Login-required editable share:

```text
edit.reason === "login_required"
  → show 登录后编辑 action
  → editor remains read-only
```

## MDXEditor Plugin Set

The first version should keep the plugin set practical and stable:

```text
headingsPlugin
listsPlugin
jsxPlugin for `.mdx` files without top-level ESM
quotePlugin
thematicBreakPlugin
linkPlugin
tablePlugin
codeBlockPlugin
codeMirrorPlugin
markdownShortcutPlugin
toolbarPlugin
```

The toolbar should expose ordinary Markdown editing controls only. It should not include upload, image insertion, custom Drive asset actions, or bespoke product-specific commands in the first version.

## Styling Boundary

Allowed:

- Import `@mdxeditor/editor/style.css`.
- Use existing dashboard shadcn/Radix components for the status/action bar.
- Use Tailwind theme token classes for layout, border, background, text, and state.
- Add minimal wrapper classes to keep MDXEditor full-height and scrollable inside the renderer shell.

Avoid:

- Hex, rgb, hsl, or Tailwind arbitrary color values.
- One-off decorative style overrides.
- Styling the editor as a new standalone product surface.
- Nesting cards or adding decorative shadows around the editor.
- Long explanatory UI copy.

If MDXEditor default CSS visually conflicts with Synapse theme tokens, handle only the specific integration issue and keep overrides narrow.

## Server Recognition

Extend Markdown file recognition to include `.mdx`:

```text
isMarkdownDriveItem(lowerName, mimeType)
  → true for ".mdx"
```

Existing `.md`, `.markdown`, `text/markdown`, and `text/x-markdown` behavior must remain unchanged.

No server-side MDX rendering is required. The current server Markdown preview can continue to render ordinary Markdown HTML. The `MDXeditor` renderer uses `preview.text` for editing.

## Error And Edge States

The renderer must preserve these states:

- Loading is handled by `DriveBrowserPage` before renderer mount.
- Missing `preview.text` uses an empty string.
- Save failure shows a short error in the renderer.
- Version conflict keeps local edits and offers reload or local download, matching `DriveCodeRenderer`.
- Truncated preview is not editable because `edit.canEdit` is false.
- Permission-denied share is read-only.
- Login-required share is read-only with a login action.

## Testing

Dashboard tests:

- Markdown renderer options are `[mdxeditor, markdown, code]`.
- `selectDefaultDriveRenderer(...)` returns `mdxeditor` for Markdown previews.
- Non-Markdown previews do not include `mdxeditor`.
- `DriveRendererContent` dispatches `mdxeditor` to `DriveMdxEditorRenderer`.
- `DriveMdxEditorRenderer` renders initial `preview.text`.
- Editing marks the renderer dirty.
- Save calls `editContext.saveText` with `text` and `baseVersionId`.
- Save is disabled when there are no changes.
- Save and reload controls are disabled while saving or reloading.
- Read-only states do not call `saveText`.
- `login_required` shows the login action.
- A 409 save error opens the conflict dialog and preserves local text.

Server/shared tests:

- `.mdx` files resolve to `previewKind: "markdown"`.
- Existing `.md`, `.markdown`, and Markdown MIME behavior remains unchanged.
- HTML, image, text, and download-only recognition remains unchanged.

## Implementation Notes

The smallest coherent implementation is:

```text
dashboard/package.json
  + @mdxeditor/editor@4.0.3

dashboard/src/features/drive-browser/renderers/
  + mdxeditor-renderer.tsx
  ~ drive-renderer-registry.ts
  ~ drive-renderer-shell.tsx

server/src/drive/drive-browser.ts
  ~ recognize .mdx as markdown

dashboard/src/features/drive-browser/drive-browser-page.test.ts
  ~ renderer option and dispatch coverage

optional:
  + dashboard/src/features/drive-browser/renderers/mdxeditor-renderer.test.tsx
```

Update `RELEASE_NOTES_PENDING.md` because users will be able to edit Drive Markdown files through MDXEditor.
