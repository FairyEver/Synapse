# Drive Markdown Annotations Design

## Summary

This design adds public discussion comments with conservative stable anchors to cloud drive `.md` files. Comments stay outside the Markdown source. Markdown Render owns comment creation and its authoritative browsing geometry; MDXEditor can display and operate existing comments through a separate editing geometry model. Monaco may edit the same source through realtime Yjs collaboration. Comment workflow status, cross-renderer controls, and targets outside Markdown rendered text and whole images remain out of scope.

The implementation scope is intentionally small:

- Only `.md` files are commentable.
- Markdown Render and MDXEditor expose existing comment threads; only Markdown Render creates threads.
- Users create comments by selecting rendered text or targeting a whole rendered image.
- Comments are plain text.
- Comment threads support replies, nested replies, edit, and delete.
- Any user who can view the document can view comments.
- A logged-in user who can view the document can comment, even without document edit permission.
- Anonymous share viewers can read comments but cannot create, edit, or delete comments.

The persistence model is intentionally broader than Markdown so future renderers can reuse it without table redesign.

## Current Code Context

The drive browser renderers live under `dashboard/src/features/drive-browser/renderers/`.

Relevant current files:

- `drive-renderer-shell.tsx` owns renderer selection and the system floating menu.
- `drive-renderer-registry.ts` maps file preview kinds to renderer options.
- `markdown-renderer.tsx` renders Markdown preview HTML and the heading outline.
- `use-drive-browser.ts` loads `DriveBrowserSnapshotDto` and handles text edits.
- `dashboard/src/lib/api.ts` contains `driveBrowserApi`.
- `server/src/drive/drive-markdown-renderer.ts` renders safe Markdown HTML and outline data.
- `server/src/drive/drive.service.ts` builds drive browser snapshots and Markdown preview HTML.
- `server/src/drive/drive.controller.ts` exposes owner and share drive browser APIs.

Important boundary:

- The system floating menu belongs to the drive browser and renderer selection. Do not add Markdown comments, outline toggles, or Markdown-internal actions to that menu.
- Markdown Render owns only its own internal reading controls.
- Markdown Render must not provide buttons that switch to MDXeditor or Code renderers.

## Product Scope

### In Scope

- `.md` files in Markdown Render and MDXEditor.
- Internal sticky Markdown Render header.
- Toggle heading outline.
- Toggle comment rail.
- Comment rail opens by default when the file has comments.
- Heading outline opens by default.
- No persisted sidebar preference.
- Select rendered text or use a rendered image's hover/focus action to create a comment.
- Highlight attached comment ranges in rendered Markdown.
- Click highlighted text to focus the corresponding thread.
- Click a comment thread to scroll to the corresponding highlighted range.
- Show orphaned text threads with `原文已修改或删除` and orphaned image threads with `图片已替换或删除`.
- Reply to a thread.
- Reply to a reply, with unlimited depth in data.
- Edit own comment.
- Delete own comment.
- File owner can delete any thread or comment.
- Plain-text comments with preserved line breaks.
- Conservative Anchor V2 resolution for text and whole-image targets.
- Realtime Markdown preview and comment invalidation from the collaboration room.
- Yjs collaboration in Monaco when `DRIVE_COLLABORATION_ENABLED=true`.
- In MDXEditor rich-text mode, highlight and align existing text/image comments while edits remain safely mappable.
- In MDXEditor source, Textarea, CodeMirror, and other unsafe mapping cases, keep comments available without claiming a precise position.

### Out of Scope

- `.mdx`, `.markdown`, plain text, HTML, PDF, standalone image files, and Code Render comments.
- Creating a comment from an MDXEditor selection.
- Image point or region selection and Mermaid comments.
- Insert-point comment UI.
- Paragraph comment UI.
- Comment status such as open, resolved, done, rejected, assigned.
- Persisted outline or comment rail preferences.
- Markdown rendering inside comments.
- Attachments, mentions, emoji reactions, tasks, and assignments.
- Any change to the system floating menu.
- Any renderer-to-renderer navigation inside Markdown Render.
- Responsive priority rules for narrow windows beyond preserving existing layout behavior.

## UI Design

The Markdown renderer remains a self-contained reading surface, while both Markdown Render and MDXEditor reuse the same comment rail presentation and actions:

```text
DriveRendererShell
  -> DriveMarkdownRenderer
       -> MarkdownRenderHeader
            -> file name
            -> outline toggle
            -> comments toggle with thread count
       -> MarkdownRenderBody
            -> outline rail
            -> rendered Markdown
            -> comment rail
```

Desktop layout:

```text
+------------------------------------------------+
| notes.md                         [目录] [评论 5] |
+--------------+-------------------+-------------+
| 目录          | 正文              | 评论         |
|              | marked text       | thread list  |
+--------------+-------------------+-------------+
```

Header rules:

- Sticky only within the Markdown Render scroll context.
- Lightweight, around existing 32px control density.
- Token backgrounds and a single bottom border.
- No decorative shadow.
- No marketing copy or feature explanation.
- No renderer switching.
- Icon buttons or compact text buttons may be used following existing dashboard component conventions.

Default rail behavior:

```text
outlineOpen = true
commentsOpen = annotationThreads.length > 0
```

These defaults are recalculated when the Markdown Render view mounts. User toggles are local to the mounted view and are not persisted.

Comment creation:

```text
User selects rendered text
  -> compact comment action appears near selection
  -> lightweight composer appears beside the selected text
  -> user enters plain text without adding a draft card to the comment rail
  -> create annotation thread plus first comment
  -> comment rail opens
  -> new thread is focused
```

Empty selections do not show the comment action.

Whole-image comment creation:

```text
User hovers or focuses a rendered image
  -> show the add-comment action above the visible top edge when it fully fits
  -> otherwise show it below the visible bottom edge when it fully fits
  -> lightweight composer appears beside the image and stays inside the visible document boundary
  -> image click still opens the lightbox; action click stops that event
  -> create annotation thread plus first comment
```

The creation composer prefers the anchor's right side, then left, below, and above. If no side fully fits, it clamps to the nearest visible document edge. Existing comment-card collision layout never participates in composer placement. After visible placement completes, the textarea receives focus once so typing can begin immediately.

Images with attached threads always show a top-right thread-count marker. Broken-image fallbacks retain the same image identity and remain focusable/commentable. Empty alt text uses the source filename, then `图片`, as the target label. The first touch implementation keeps existing markers interactive but does not add a separate compact-mode creation entry.

Comment rail:

- Lists every non-deleted thread for the document, regardless of the version where the thread was created.
- Keeps attached threads aligned with their computed document position.
- Shows a compact unlocated-comment entry at the top of the rail when orphaned threads exist.
- Opens orphaned threads in a dedicated scrollable dialog, ordered by latest activity, instead of mixing their cards into the positioned comment flow.
- Shows the original selected quote and `原文已修改或删除` on orphaned threads.
- Displays thread count in the header toggle.
- Does not include filters because there is no product status.
- Shows nested replies as a readable discussion stream, not an infinitely indented tree.
- A reply can show "回复 <name>" metadata instead of increasing indentation for every level.
- A thread card exposes at most one composer at a time. Editing replaces the comment body and its actions; reply and edit modes never appear together.
- Deletable comments show a direct delete icon. The first click changes it to a check icon, and the second click performs the deletion.
- Deleting a comment also hides all of its descendant replies, including legacy descendants whose parent was deleted before this rule was introduced.
- Deleting the first comment removes the entire thread and its rendered text marker.
- The shared rail receives either a positioned document coordinate or a renderer-local `unavailable` placement for each thread.
- Server `anchorStatus` remains authoritative. Renderer-local `unavailable` never rewrites an attached thread as `orphaned`.
- Renderer-local placement failures display `编辑中暂未定位`; authoritative orphaned text and image threads keep their existing deletion/modified messages.

MDXEditor behavior:

- The renderer toolbar exposes `评论 N` for `.md` only. Existing comments open the rail on first load; after the user closes it, the current mount does not reopen it automatically.
- Wide layouts use a resizable editor/comment split. Compact layouts use a right-side sheet and list presentation.
- Rich-text mode supports highlight, rail alignment, navigation, replies, edit, and delete.
- Source and forced Textarea modes use list presentation. CodeMirror text remains part of the offset stream so later content keeps stable offsets, but ranges touching CodeMirror are not measured precisely.
- Editing strictly before a range shifts its local working range by the Unicode code-point delta. Editing after a range leaves it unchanged. Editing through the range makes local placement unavailable until save/reload establishes a new server-backed baseline.

Rendered text markers:

- Attached ranges receive a light inline marker.
- Markers must not make the Markdown harder to read.
- Orphaned threads do not render a body marker.
- Orphaned threads remain readable and writable in the unlocated section.

Rendered image markers:

- The focused image thread marks the whole image with the existing theme ring.
- A thread-count marker counts threads, not replies; focusing a new image chooses its earliest thread and preserves the current thread when it already belongs to that image.
- The image action overlay is measured independently from the Markdown renderer and uses the intersection of the window, scroll container, and horizontal clipping ancestors.

### Rendering Style And Positioning Invariants

- Typography and spacing changes such as font size, font weight, line height, block spacing, reading width, and table-cell padding do not change annotation anchor semantics and must not introduce anchor-algorithm branches or duplicated positioning configuration.
- Highlight rectangles and comment-rail positions are derived from the rendered DOM. Pure layout changes must keep the DOM measurement and `ResizeObserver` flow authoritative, with regression coverage for highlight alignment, rail alignment, and comment navigation after reflow.
- Changes to visible text, DOM text order, Markdown parser or renderer semantics, image alt handling, line breaks, code blocks, tables, or ignored/generated nodes must update and test both the server Markdown projection and the Renderer rendered-text model when their shared text stream changes.
- Changes to the document scroll container, overlay coordinate space, virtualization, collapsed content, transforms, or asynchronous geometry that can move text without notifying the observed Markdown body must update the coordinate conversion or add an explicit remeasurement trigger.
- Markdown Render and MDXEditor must not share text-model or geometry calculations. Browser positioning remains unchanged; only rail presentation and actions are shared.
- MDXEditor comment cards use editor document coordinates: `targetRect.top - scrollerRect.top + scrollTop`. Its highlight overlay uses content-host coordinates: `targetRect - contentHostRect`.
- Width changes, panel resize, responsive padding, scrollbar changes, images, tables, and font loading invalidate geometry only. They do not rebuild the editor text model.
- MDXEditor DOM mutations and Lexical reconciliation signals invalidate the text model and geometry. Mutation, resize, image, font, and editor signals enter one animation-frame scheduler with at most one model rebuild and one React geometry commit per frame.
- Pure scrolling never traverses editor text or measures ranges; it only updates the comment anchor layer transform.
- Geometry retains subpixel values and ignores changes below `0.5px` to prevent high-DPI and zoom update loops.
- The highlight overlay is outside the observed editor root and does not participate in layout. Natural content height and bottom comment compensation are measured separately.

## Data Model

Use generic drive annotation tables, not Markdown-specific comment tables.

```prisma
model DriveAnnotationThread {
  id              String   @id @default(cuid())
  itemId          String
  item            DriveItem @relation(fields: [itemId], references: [id], onDelete: Restrict)
  baseVersionId   String?
  targetKind      String   @db.VarChar(64)
  target          Json
  anchorStatus    String   @default("attached") @db.VarChar(32)
  createdByUserId String
  createdByUser   User     @relation(fields: [createdByUserId], references: [id], onDelete: Restrict)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  comments        DriveAnnotationComment[]

  @@index([itemId, deletedAt, createdAt])
  @@index([createdByUserId, createdAt])
  @@index([anchorStatus])
}

model DriveAnnotationComment {
  id              String   @id @default(cuid())
  threadId        String
  thread          DriveAnnotationThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  parentCommentId String?
  parentComment   DriveAnnotationComment? @relation("DriveAnnotationCommentReplies", fields: [parentCommentId], references: [id], onDelete: Restrict)
  replies         DriveAnnotationComment[] @relation("DriveAnnotationCommentReplies")
  body            String
  createdByUserId String
  createdByUser   User     @relation(fields: [createdByUserId], references: [id], onDelete: Restrict)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  editedAt        DateTime?
  deletedAt       DateTime?

  @@index([threadId, createdAt])
  @@index([parentCommentId])
  @@index([createdByUserId, createdAt])
}
```

Existing `User` and `DriveItem` models need relation fields added when implementing.

Annotation threads belong to `itemId`, not to a file version. `baseVersionId` records the version used to create the original text anchor and protects new-thread creation from stale previews. It must not filter thread visibility or block replies, edits, or deletes after the document changes.

`anchorStatus` is system positioning state only:

```text
attached: the target is confidently attached to current rendered text
shifted: the target was reattached after content changes
orphaned: the target could not be safely reattached
```

There is no product status such as resolved.

Anchor V2 is authoritative. `DriveAnnotationAnchor` is a one-to-one record owned by the thread and stores selectors, current position/quote status, last resolved ranges, confidence, parser/version context, idempotency, and independent deletion metadata. The legacy `target` and `anchorStatus` fields remain a temporary compatibility projection; `target` preserves the original snapshot, while consumers use `anchor` for the current position. `shifted` is not a V2 product state. Neither text nor image targets expose manual reassociation.

Rollout policy: the Anchor V2 migration intentionally deletes all pre-V2 annotation threads and their comments. V1 browser offsets use UTF-16 units and cannot be losslessly converted to the V2 Unicode code-point coordinate system, so the migration must not synthesize V2 anchors from legacy targets. `DriveItem`, `DriveShare`, `DriveFileVersion`, source objects, and share identifiers are not modified by this cleanup. Threads created after the migration write both the V2 anchor and the temporary legacy projection so an application rollback can still read newly created comments.

## Target Model

The first version supports rendered `textRange` and whole `image` targets.

```ts
type DriveAnnotationTargetV1 = {
  schemaVersion: 1
  kind: "textRange"
  surface: "markdownRenderedText"
  range: {
    start: number
    end: number
  }
  quote: {
    exact: string
    prefix: string
    suffix: string
  }
  source?: {
    startOffset: number
    endOffset: number
    lineStart: number
    lineEnd: number
  }
  blockHint?: {
    path: number[]
    type: string
    textHash: string
  }
}

type DriveAnnotationImageTargetV1 = {
  schemaVersion: 1
  kind: "image"
  surface: "markdownRenderedImage"
  imageId: string
  resourceKey: string
  source: { startOffset: number; endOffset: number }
  blockHint: { blockId: string; blockIndex: number; imageIndex: number; path: number[] }
  snapshot: { src: string; alt: string; title: string | null }
}
```

`range.start` and `range.end` are offsets in the rendered plain-text stream, not raw Markdown source offsets. This matches what the user selected in Render view.

Example:

```text
Markdown source:
这是 **重点** 内容

Rendered text:
这是 重点 内容
```

The comment attaches to `重点` in rendered text, while source offsets are only hints.

Although the text model can represent collapsed ranges with `start === end`, the first UI does not expose insert-point comments. Image identity is based on the authored resource, never on alt or title: `/files/<assetId>` ignores query and fragment, relative paths use Markdown path normalization, HTTP(S) normalizes scheme and host while preserving path/query/fragment, and data URLs store only a hash.

## Anchor Resolution

The V1 rendered-text algorithm below is retained only as the rollback projection for newly created comments. Pre-V2 comments are not migrated. Anchor V2 resolves in this fixed order:

```text
1. Same-Epoch Yjs relative start/end positions.
2. Stable Markdown block id plus block-local rendered range.
3. Bounded old-to-new source diff mapping.
4. A unique exact quote.
5. Prefix/suffix, heading ancestry, block type, and original-distance scoring.
6. Ambiguous, deleted, unavailable, or orphaned when evidence is insufficient.
```

Offsets in Anchor V2 use Unicode code points. UI selection must end at grapheme boundaries. The service response is authoritative; the Renderer must not maintain a second quote-search implementation. Moving an attached range does not create a `shifted` state. Text edited inside a still-related range is `attached/modified`; fully deleted source is `source_deleted/deleted`.

Image anchors resolve in this order: current source range, same-Epoch Yjs relative position, bounded source diff, stable block plus block-local image index, then globally unique resource identity. Every candidate must have the same resource identity. An attached image always has `quoteStatus=exact`; a replaced, deleted, or ambiguous image becomes `orphaned/deleted` and never `modified`. Projection metadata is versioned; an old projection is used only to inherit stable block IDs before the image metadata cache is rebuilt.

The implementation should build a current rendered text model from the same sanitized Markdown render used by the preview:

```text
Markdown source
  -> Markdown AST
  -> sanitized rendered HTML
  -> renderedText
  -> text nodes with offsets
  -> optional block hints
```

Resolution order:

```text
1. If baseVersionId has not changed and the stored range matches quote.exact, mark attached.
2. Search the current rendered text for the complete quote.exact.
3. If there is one match, mark attached or shifted based on its position.
4. If there are multiple matches, require prefix or suffix evidence and use distance only as a secondary score.
5. If the complete quote is missing, only partially remains, or cannot be distinguished safely, mark orphaned.
```

Safety principle:

```text
Prefer orphaned over an incorrect attachment.
```

Expected scenarios:

- Inserting paragraphs before the selection should reattach via exact quote or context.
- Splitting a paragraph should reattach via exact quote or context.
- Edits that remove any part of the selected quote become orphaned instead of attaching to a guessed range.
- Deleted selected text becomes orphaned.
- Repeated identical text uses context and distance scoring.
- Ambiguous repeated text becomes orphaned.
- Markdown syntax changes that keep rendered text equivalent should remain attached or shifted.

## API Design

Owner routes:

```text
GET    /api/drive/browser/owner/items/:itemId/annotations
POST   /api/drive/browser/owner/items/:itemId/annotations
POST   /api/drive/browser/owner/items/:itemId/annotations/:threadId/comments
PATCH  /api/drive/browser/owner/items/:itemId/annotations/comments/:commentId
DELETE /api/drive/browser/owner/items/:itemId/annotations/comments/:commentId
DELETE /api/drive/browser/owner/items/:itemId/annotations/:threadId
POST   /api/drive/browser/owner/items/:itemId/collaboration/checkpoint
```

Share routes:

```text
GET    /api/drive/browser/shares/:shareId/annotations
POST   /api/drive/browser/shares/:shareId/annotations
POST   /api/drive/browser/shares/:shareId/annotations/:threadId/comments
PATCH  /api/drive/browser/shares/:shareId/annotations/comments/:commentId
DELETE /api/drive/browser/shares/:shareId/annotations/comments/:commentId
DELETE /api/drive/browser/shares/:shareId/annotations/:threadId

GET    /api/drive/browser/shares/:shareId/items/:itemId/annotations
POST   /api/drive/browser/shares/:shareId/items/:itemId/annotations
POST   /api/drive/browser/shares/:shareId/items/:itemId/annotations/:threadId/comments
PATCH  /api/drive/browser/shares/:shareId/items/:itemId/annotations/comments/:commentId
DELETE /api/drive/browser/shares/:shareId/items/:itemId/annotations/comments/:commentId
DELETE /api/drive/browser/shares/:shareId/items/:itemId/annotations/:threadId
POST   /api/drive/browser/shares/:shareId/items/:itemId/collaboration/checkpoint
```

Agent-facing Link Intake routes expose the same share annotation service without joining the browser collaboration room:

```text
POST   /api/drive/link-intake/annotations/threads/list
POST   /api/drive/link-intake/annotations/threads
POST   /api/drive/link-intake/annotations/comments
PATCH  /api/drive/link-intake/annotations/comments
DELETE /api/drive/link-intake/annotations/comments
DELETE /api/drive/link-intake/annotations/threads
```

These routes accept only current-origin `/share/...` `.md` targets and reuse password checks, child-item resolution, logged-in identity, annotation permissions, anchor validation, visibility projection, email redaction for list and mutation responses, and audit behavior. Text creation identifies visible text with `{ exact, prefix?, suffix? }`. Image creation uses `{ kind: "image", imageId }`, where `imageId` must come from the current complete `read_text.markdownImages` response; stale or unknown IDs return target-not-found without positional guessing. The server generates V2 selectors against the current Markdown projection/version and rejects missing or ambiguous targets. The API does not expose reassociation, source offsets, CRDT coordinates, file editing, presence, or collaboration-room control.

The custom WebSocket endpoint is `/api/drive/collaboration`. Its first message is a versioned JSON join containing owner/share context, item identity, client identity, Epoch, and state vector; credentials remain in existing cookies and the server requires the exact configured public Origin. Binary messages carry Yjs sync/update/awareness. Control messages carry durable acknowledgement, permission changes, Epoch replacement, preview changes, and comment invalidation. Message payloads are capped at 256 KiB and awareness never carries email, document content, or comment content.

The repeated owner/share route shape keeps API calls close to the existing drive browser access model. Internally, both resolve to the real `DriveItem.id`.

Create thread:

```json
{
  "targetKind": "textRange",
  "target": {
    "schemaVersion": 1,
    "kind": "textRange",
    "surface": "markdownRenderedText",
    "range": { "start": 1280, "end": 1306 },
    "quote": {
      "exact": "被选中的文字",
      "prefix": "前面一段上下文",
      "suffix": "后面一段上下文"
    }
  },
  "body": "评论内容"
}
```

Create an image thread through Link Intake/MCP:

```json
{
  "target": { "kind": "image", "imageId": "mdimg_..." },
  "body": "评论内容"
}
```

For a complete, untruncated Markdown response, `read_text` includes `source.versionId` and `markdownImages` entries with `imageId`, 1-based document index, authored source, alt, and title. Non-Markdown and truncated responses omit `markdownImages`.

Reply:

```json
{
  "parentCommentId": "comment-id-or-null",
  "body": "回复内容"
}
```

Edit:

```json
{
  "body": "新的评论内容"
}
```

## Permission Rules

Read annotations:

```text
Owner route: authenticated owner can read.
Share route: anyone who can view the shared document can read.
```

Create annotations:

```text
Must be logged in.
Must be able to view the document.
Document edit permission is not required.
```

Edit comments:

```text
Only the comment author can edit their own comment.
Deleted comments cannot be edited.
```

Delete comments:

```text
Comment author can delete their own comment.
File owner can delete any comment on the file.
Permission is checked only for the selected comment.
Deleting a comment also deletes all descendant replies regardless of author.
Deleting the first comment deletes the entire thread.
```

Delete threads:

```text
File owner can delete any thread.
Thread creator can delete the thread only when all visible comments in the thread are theirs.
```

Share behavior:

```text
Anonymous share viewer:
  can read document
  can read comments
  cannot comment

Logged-in share viewer:
  can read document
  can read comments
  can comment
```

## Frontend Implementation Plan

New client API:

```text
dashboard/src/lib/api.ts
  driveAnnotationApi
```

New hook:

```text
dashboard/src/features/drive-browser/use-drive-annotations.ts
```

Responsibilities:

- Load annotations for owner/share context.
- Create thread.
- Reply to thread.
- Edit comment.
- Delete comment.
- Delete thread where allowed.
- Expose loading and mutation states.

Markdown renderer changes:

```text
dashboard/src/features/drive-browser/renderers/markdown-renderer.tsx
  internal sticky header
  outline toggle
  comment toggle
  selection comment action
  annotated HTML rendering
  comment rail
```

Shared comment rail and MDXEditor positioning:

```text
dashboard/src/features/drive-browser/drive-comments-rail.tsx
  shared cards, actions, collision avoidance, navigation, list mode

dashboard/src/features/drive-browser/renderers/mdxeditor-comment-geometry.ts
  editor-only Unicode text model
  conservative working-range updates
  batched DOM range and image measurement
  ResizeObserver, MutationObserver, image, and font scheduling

dashboard/src/features/drive-browser/renderers/mdxeditor-comment-observer-plugin.ts
  Lexical reconciliation and MDXEditor view-mode signals
```

Suggested helper modules:

```text
dashboard/src/features/drive-browser/renderers/markdown-annotation-target.ts
  build rendered text model
  selection to textRange target
  image id to whole-image target
  DOM range to rendered text offsets

dashboard/src/features/drive-browser/renderers/markdown-annotation-render.ts
  resolve target results to HTML markers
  create marker metadata for click and scroll sync

dashboard/src/features/drive-browser/renderers/markdown-image-comments-overlay.tsx
  measure visible image edges
  own hover/focus state and thread-count actions
```

Rendering approach:

```text
preview.html
  -> DOMParser
  -> TreeWalker maps text nodes to rendered offsets
  -> split text nodes at annotation boundaries
  -> add data-annotation-thread-id markers
  -> serialize trusted annotated HTML
  -> render in Markdown body
```

The input HTML must remain server-sanitized preview HTML. Comment bodies must be React text nodes, never injected as HTML.

## Backend Implementation Plan

New service:

```text
server/src/drive/drive-annotation.service.ts
```

Responsibilities:

- Resolve owner item access.
- Resolve share item access.
- Validate `.md` support for first version.
- Validate text/image `targetKind` and target schema.
- Create thread plus first comment transactionally.
- Add replies.
- Edit own comment.
- Soft-delete a comment and all descendant replies.
- Soft-delete the thread when its first comment is deleted.
- Soft-delete threads.
- Return author display metadata.
- Refresh anchorStatus when annotations are listed for a current file version.

Controller changes:

```text
server/src/drive/drive.controller.ts
  owner annotation routes under DriveUserController
  share annotation routes under public share controller section
```

Shared DTOs:

```text
shared/src/drive.ts
  DriveAnnotationThreadDto
  DriveAnnotationCommentDto
  DriveAnnotationTargetKind
  DriveAnnotationAnchorStatus
  DriveAnnotationCreateInput
  DriveAnnotationReplyInput
  DriveAnnotationCommentUpdateInput
```

Markdown rendering:

- Keep current safe Markdown HTML and outline behavior.
- Add or reuse rendered-text and image-projection helpers for anchor resolution.
- Do not allow comments to modify Markdown source.

## Testing Plan

Server tests:

- Create thread plus first comment.
- Reply to comments with nested parent IDs.
- Edit own comment.
- Reject editing another user's comment.
- Delete own comment.
- File owner deletes another user's comment.
- Deleting a parent comment also deletes all nested descendants regardless of author.
- Deleting the first comment removes the entire thread.
- File owner deletes a thread.
- Anonymous share viewer can list annotations.
- Anonymous share viewer cannot create annotations.
- Logged-in share viewer can create annotations with read-only document access.
- `.mdx`, `.markdown`, and non-Markdown files reject comment creation in first version.
- Deleted comments and all of their descendants are omitted from responses.
- Legacy threads whose first comment was deleted are omitted from responses.
- Threads created on older versions remain visible and writable after later saves or restores.

Anchor tests:

- Insert content before selected text.
- Split paragraph containing selected text.
- Change Markdown emphasis syntax while rendered text stays the same.
- Partially edit selected text and mark it orphaned.
- Delete selected text and mark orphaned.
- Repeat exact quote multiple times and use prefix/suffix to choose.
- Repeat exact quote ambiguously and mark orphaned.
- Keep image attachment when alt/title changes or a `/files/<assetId>` query changes.
- Reattach an image after movement when stable block/index or unique resource identity is sufficient.
- Orphan images replaced in place, deleted, or ambiguous among repeated resources.

Frontend tests:

- Markdown header appears only inside Markdown Render.
- Header does not include renderer switching.
- Outline opens by default.
- Comments rail opens by default when comments exist.
- Comments rail closes and opens locally without persistence.
- Selecting rendered text shows comment action.
- Empty selection does not show comment action.
- Creating a comment opens the comments rail.
- Attached annotations render body markers.
- Orphaned annotations do not render body markers and appear in the rail.
- Orphaned annotations appear first with their original quote and remain actionable.
- Comment bodies render as plain text with line breaks.
- Replies render without unbounded indentation.
- Image hover/focus action chooses top, bottom, or hidden placement from visible edges.
- Image action does not open the lightbox; image click still does.
- Attached image thread markers stay clickable and count threads.
- Broken and empty-alt images remain commentable; replaced/deleted images show `图片已替换或删除` without reassociation.
- Existing `.md` comments appear in MDXEditor, while `.mdx` remains excluded.
- Rich-text comments reposition after editor and rail width changes without changing Markdown Render positioning behavior.
- Insertions/deletions before a comment shift the local range; edits after it do not; overlapping edits show `编辑中暂未定位`.
- Source and Textarea modes show comments as a list, and CodeMirror ranges do not claim precise placement.
- Multiple resize/mutation signals in one frame produce one scheduled measurement; duplicate ranges share one DOM Range measurement.
- Pure scroll does not rebuild the text model or measure DOM ranges, and unmount cancels pending frames and observers.

## Risks And Mitigations

Risk: annotation marker insertion corrupts sanitized HTML.

Mitigation: only transform server-sanitized preview HTML, use DOMParser and text-node splitting, never inject comment text as HTML.

Risk: anchor resolver attaches a comment to the wrong text.

Mitigation: conservative scoring. If confidence is low or ambiguous, mark orphaned.

Risk: rendered text offsets diverge from source offsets.

Mitigation: rendered text offsets are the primary coordinate. Source offsets and line numbers are hints only.

Risk: share access and logged-in commenting interact incorrectly.

Mitigation: keep read access tied to existing share browser access. Keep write access behind UserAuthGuard plus share-view permission.

Risk: nested replies become unreadable in a narrow right rail.

Mitigation: store tree data, render as a linear discussion stream with "回复 <name>" metadata instead of recursive visual indentation.

Risk: active editing causes the editor DOM to diverge from the last server-resolved anchor.

Mitigation: use a renderer-local working range only for unambiguous prefix/suffix edits, never search or fuzzily reattach in the client, and reset from server results after save, reload, version, or mode changes.

Risk: responsive reflow and asynchronous assets cause excessive measurement work.

Mitigation: separate model and geometry dirty flags, share observers and range measurements, batch work into animation frames, and keep scrolling transform-only.

## Future Extensions

The tables are generic enough to support later target kinds without schema redesign:

```text
plainTextRange
htmlTextRange
pdfRegion
imageRegion
codeTextRange
```

Future target examples:

```json
{
  "schemaVersion": 1,
  "kind": "pdfRegion",
  "page": 3,
  "rect": { "x": 0.12, "y": 0.34, "width": 0.3, "height": 0.08 },
  "quote": { "exact": "visible PDF text" }
}
```

```json
{
  "schemaVersion": 1,
  "kind": "imageRegion",
  "rect": { "x": 0.12, "y": 0.34, "width": 0.3, "height": 0.08 }
}
```

`imageRegion` is distinct from the implemented whole-image Markdown target. Future renderers should own their positioning model while reusing the shared comment rail when its interaction model fits.
