# ADR 0213: Keep Drive Markdown Source Authoritative Across Collaboration

## Status

Accepted

## Context

Drive Markdown needs stable comments, live Monaco editing, readable history, offline recovery, and safe transitions through upload overwrite, history restore, and MDXEditor full-document saves. Storing a private rich-document model would make downloaded Markdown, MCP content operations, and version history disagree about the authoritative content. Treating each CRDT update as a file version would make history unusable. Reattaching comments by rendered-text search alone can silently attach a discussion to the wrong repeated phrase.

## Decision

- The original Markdown source text remains the authoritative document data. Collaboration uses a Yjs `Y.Text` containing that source; it does not introduce a private rich-document format.
- Durable collaboration updates and user-visible `DriveFileVersion` records are separate. Updates are persisted as object-storage segments; idle, maximum-duration, last-editor, manual, and external-change boundaries create full-content checkpoints.
- A collaboration Epoch starts from one checkpoint. Whole-document replacement, upload overwrite, and history restore checkpoint accepted work first and then create a new Epoch. Unacknowledged old-Epoch edits remain local and are never replayed automatically.
- Markdown Projection is a derived, versioned object. It provides stable block identities and source-to-rendered mappings but never becomes authoritative content.
- Comment Anchor is independent from its thread and comments. Anchor resolution uses CRDT relative positions, stable semantic blocks, bounded source diff, exact quote, and contextual scoring in that order. Insufficient or tied evidence produces an unlocated state rather than a guessed attachment.
- HTTP remains authoritative for comment mutations and explicit checkpoints. The custom WebSocket transports Yjs sync, awareness, durable acknowledgements, permission changes, preview changes, comment invalidation, and Epoch replacement.
- Browser Monaco is the collaborative editor. Markdown Render is a live read projection. MDXEditor remains a single-user, explicit full-document save surface and must pass the current-checkpoint conflict guard.
- Drive MCP content mutations continue through the versioned Drive service. Collaboration and comment operations are browser-only in this decision; no MCP tool is added for them.

## Consequences

Comments can remain attached across ordinary edits and moves without accepting wrong matches. Offline updates survive locally until acknowledged, and history contains meaningful checkpoints rather than keystrokes. The system must retain projection/parser versions, collaboration segments, quota reservations, and an item-level serialization boundary. Multi-instance room distribution remains behind `DriveCollaborationBus`; the first implementation is intentionally single-server and does not add Redis.
