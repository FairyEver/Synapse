# Drive Single File Reader Design

Date: 2026-06-16
Scope: `dashboard/src/features/drive-browser/`, `RELEASE_NOTES_PENDING.md`

## Goal

When a user opens a file from Drive, the main content area should become a single reader: a compact header with file identity and actions, followed directly by the file renderer. The left metadata panel and resizable split layout remain only for folder browsing.

## Current Context

`dashboard/src/features/drive-browser/drive-browser-page.tsx` already contains two layout paths:

- `DriveBrowserView`: renders a bordered browser surface with breadcrumbs, actions, a file/folder list panel, and a preview panel.
- `DriveSingleFileReaderView`: renders a single-file reader header and preview body without the split browser chrome.

`shouldRenderDriveSingleFileReader()` currently returns `true` only for shared files. Owner and console Drive files still render through the split browser, so clicking a Markdown file in the console shows a redundant left panel with filename, size, and kind while the actual document appears on the right.

## Product Behavior

- Folder pages keep the existing browser layout: folder list on the left or top and preview on the right or bottom.
- File pages use the single reader layout for owner and share contexts.
- The console shell stays intact. The console page still shows the app sidebar and page header, but the Drive page body no longer splits into file information and preview when the current item is a file.
- The reader header contains:
  - file icon and filename,
  - concise file metadata: size, kind, and updated time when available,
  - download action when the file can be downloaded,
  - owner-only HTML visit action when `preview.visitUrl` is present.
- The reader body contains only the renderer:
  - Markdown keeps the renderer-level `预览` / `源码` tabs.
  - Text and HTML source show the text renderer.
  - Images show the image renderer.
  - Download-only files show the download-only state and button.
- No share, publish, rename, move, delete, or management actions are added to the reader.

## UI Rules

- Use existing shadcn/Radix components and Tailwind layout utilities.
- Do not introduce custom colors, gradients, decorative shadows, nested cards, or marketing copy.
- Keep copy short and operational.
- Keep file metadata in the header, not in a separate side panel.
- Preserve existing renderer behavior and content sanitization boundaries.

## Data Flow

The existing `DriveBrowserSnapshotDto` remains the only data source. The layout switch depends on `snapshot.current.type === "file"` instead of access context. Actions continue to come from `getDriveBrowserActions(snapshot)`.

No server API, route contract, or shared DTO change is required.

## Testing

Focused tests should cover:

- `shouldRenderDriveSingleFileReader()` returns true for owner files and share files, false for folders.
- Owner Markdown files render through `DriveSingleFileReaderView` without the resizable panel group or metadata side badge.
- The reader header includes useful metadata for owner files.
- Folder fixed layout still renders the resizable panel group.

## Release Note

This is user-visible. Add a pending release note explaining that Drive file preview now opens as a focused reader instead of a split detail/preview layout.
