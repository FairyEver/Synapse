# Drive Markdown Annotations Design

## Summary

This design adds lightweight public discussion comments to cloud drive `.md` files in the Markdown Render view. Comments are stored outside the Markdown file, attached to rendered text ranges, and shown in a right-side comment rail. The first version deliberately avoids workflow status, realtime collaboration, cross-renderer controls, and non-Markdown file types.

The implementation scope is intentionally small:

- Only `.md` files are commentable.
- Only the Markdown Render view exposes comment UI.
- Users create comments by selecting rendered text.
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

- `.md` files in Markdown Render.
- Internal sticky Markdown Render header.
- Toggle heading outline.
- Toggle comment rail.
- Comment rail opens by default when the file has comments.
- Heading outline opens by default.
- No persisted sidebar preference.
- Select rendered text to create a comment.
- Highlight attached comment ranges in rendered Markdown.
- Click highlighted text to focus the corresponding thread.
- Click a comment thread to scroll to the corresponding highlighted range.
- Show orphaned threads in the comment rail with a short "位置已变化" message.
- Reply to a thread.
- Reply to a reply, with unlimited depth in data.
- Edit own comment.
- Delete own comment.
- File owner can delete any thread or comment.
- Plain-text comments with preserved line breaks.

### Out of Scope

- `.mdx`, `.markdown`, plain text, HTML, PDF, image, and Code Render comments.
- Insert-point comment UI.
- Paragraph comment UI.
- Comment status such as open, resolved, done, rejected, assigned.
- Realtime refresh, SSE, WebSocket, or polling.
- Persisted outline or comment rail preferences.
- Markdown rendering inside comments.
- Attachments, mentions, emoji reactions, tasks, and assignments.
- Any change to the system floating menu.
- Any renderer-to-renderer navigation inside Markdown Render.
- Responsive priority rules for narrow windows beyond preserving existing layout behavior.

## UI Design

The Markdown renderer becomes a self-contained reading surface:

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
  -> user enters plain text
  -> create annotation thread plus first comment
  -> comment rail opens
  -> new thread is focused
```

Empty selections do not show the comment action.

Comment rail:

- Lists all non-deleted threads ordered by computed document position, then creation time for orphaned threads.
- Displays thread count in the header toggle.
- Does not include filters because there is no product status.
- Shows nested replies as a readable discussion stream, not an infinitely indented tree.
- A reply can show "回复 <name>" metadata instead of increasing indentation for every level.
- Deleted comments with visible replies render as "评论已删除".
- Deleted comments with no visible replies are hidden.

Rendered text markers:

- Attached ranges receive a light inline marker.
- Markers must not make the Markdown harder to read.
- Orphaned threads do not render a body marker.
- The comment rail still shows orphaned threads with "位置已变化".

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

`anchorStatus` is system positioning state only:

```text
attached: the target is confidently attached to current rendered text
shifted: the target was reattached after content changes
orphaned: the target could not be safely reattached
```

There is no product status such as resolved.

## Target Model

First version uses only `textRange`.

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

Although the model can represent collapsed ranges with `start === end`, the first UI does not expose insert-point comments.

## Anchor Resolution

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
1. If baseVersionId has not changed, use stored range.
2. If stored range still matches quote.exact, mark attached.
3. Search near old range for quote.exact, mark shifted.
4. Search full rendered text for quote.exact.
   If multiple matches exist, score by prefix, suffix, and distance from old range.
5. If exact quote is missing, use prefix and suffix to bracket a likely region.
   Accept only if the candidate text is similar enough.
6. Use blockHint to find a similar block, then search within that block.
7. If no confident result exists, mark orphaned.
```

Safety principle:

```text
Prefer orphaned over an incorrect attachment.
```

Expected scenarios:

- Inserting paragraphs before the selection should reattach via exact quote or context.
- Splitting a paragraph should reattach via exact quote or context.
- Small edits inside the selected text may reattach via prefix and suffix.
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
```

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

Suggested helper modules:

```text
dashboard/src/features/drive-browser/renderers/markdown-annotation-target.ts
  build rendered text model
  selection to textRange target
  DOM range to rendered text offsets

dashboard/src/features/drive-browser/renderers/markdown-annotation-render.ts
  resolve target results to HTML markers
  create marker metadata for click and scroll sync
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
- Validate `targetKind` and target schema.
- Create thread plus first comment transactionally.
- Add replies.
- Edit own comment.
- Soft-delete comments.
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
- Add or reuse a rendered text extraction helper for anchor resolution.
- Do not allow comments to modify Markdown source.

## Testing Plan

Server tests:

- Create thread plus first comment.
- Reply to comments with nested parent IDs.
- Edit own comment.
- Reject editing another user's comment.
- Delete own comment.
- File owner deletes another user's comment.
- File owner deletes a thread.
- Anonymous share viewer can list annotations.
- Anonymous share viewer cannot create annotations.
- Logged-in share viewer can create annotations with read-only document access.
- `.mdx`, `.markdown`, and non-Markdown files reject comment creation in first version.
- Deleted comment without replies is omitted from response.
- Deleted comment with visible replies returns a deleted placeholder.

Anchor tests:

- Insert content before selected text.
- Split paragraph containing selected text.
- Change Markdown emphasis syntax while rendered text stays the same.
- Slightly edit selected text and recover through context.
- Delete selected text and mark orphaned.
- Repeat exact quote multiple times and use prefix/suffix to choose.
- Repeat exact quote ambiguously and mark orphaned.

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
- Comment bodies render as plain text with line breaks.
- Replies render without unbounded indentation.

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

These future renderers should own their own internal comment UI, just as Markdown Render owns its internal header and rails.
