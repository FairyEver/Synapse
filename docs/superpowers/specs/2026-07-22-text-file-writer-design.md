# Text File Writer App Capability Design

## Goal

Add a built-in Text File Writer that lets an Agent or user submit one complete string and one local absolute path in a single call. One capability-package service owns validation, canonical-path authorization, safe filesystem mutation, concurrency control, and audit behavior; the system app, MCP, Workflow, and the existing Text Extractor save action are thin adapters.

The product does not impose a text-length limit or require caller-side chunking. Capacity remains bounded by Electron IPC, process memory, the filesystem, and available storage. Internal chunking is allowed only when it preserves the exact bytes produced by encoding the complete input.

## Stable identities

| Surface | Identity |
| --- | --- |
| User-visible app and Workflow node | `文本写入文件` |
| System app id | `text-file-writer` |
| App namespace | `text_file_writer` |
| Capability id | `app.text_file_writer.file.write` |
| MCP tool | `app_text_file_writer_file_write` |
| Workflow node type | `text_file_writer_file_write` |
| Workflow share requirement | `app.text_file_writer.file.write@1.0.0` |

The capability manifest does not declare deep links. Registration of the app, capability, MCP tool, or Workflow node must not expose a protocol route.

## Public contract

All entry points use the same strict input:

```ts
type TextFileWriteInput = {
  text: string
  path: string
  encoding?: "utf8" | "utf16le"
  overwrite?: boolean
}
```

`encoding` defaults to `utf8`; `overwrite` defaults to `false`. Empty text is valid. No entry point may set `text.maxLength`, truncate content, add a BOM, trim, normalize line endings, append a final newline, or add format-specific CSV/Markdown/TXT processing.

The target path determines the format from its final extension. Supported extensions are `.txt`, `.md`, and `.csv`, compared case-insensitively and defined once in shared code. The service does not append or repair extensions. It accepts only a current-platform absolute path, does not expand `~`, environment variables, or shell expressions, and rejects `file://` URLs. Workflow interpolation happens before the same shared validation.

Success returns:

```ts
type TextFileWriteResult = {
  path: string
  fileName: string
  format: "txt" | "md" | "csv"
  encoding: "utf8" | "utf16le"
  size: number
  overwritten: boolean
}
```

`path` is the normalized actual target used for authorization and audit. `size` is the number of bytes written. The result does not echo the text.

## Filesystem and concurrency semantics

- Resolve the deepest existing ancestor through `realpath`, append missing path segments, and use that actual-target meaning consistently for locking, permission checks, audit, writing, and results.
- Allow parent-directory symlinks and Windows junctions. Recursively create missing parent directories. Re-resolve before mutation and stop when the actual target drifts.
- Existing targets must be ordinary files. Reject target symlinks, directories, devices, and other non-regular entries.
- New files use POSIX mode `0666` subject to `umask`; Windows inherits directory ACLs. Atomic overwrite preserves the existing file mode, and inability to restore it fails before commit.
- Stage encoded bytes in an exclusively created, same-directory, clearly prefixed temporary file. Sync the temporary file before commit, but do not promise parent-directory fsync or power-loss durability.
- Without overwrite permission, commit only with atomic no-clobber semantics. With overwrite permission, never follow a target symlink and never truncate the live target before validation.
- If a target is modified or replaced after observation, abort with `TARGET_CHANGED`, retain the external version, and require an explicit retry even when overwrite was allowed. Cross-process detection is best effort and does not claim to eliminate TOCTOU.
- Serialize operations per normalized actual target inside the process. Waiting is abortable, different targets remain concurrent, and idle lock entries are removed.
- Every caught failure or cancellation removes its temporary file. A crash, forced termination, or power loss can leave a prefixed temporary file; the first version does not scan arbitrary directories or delete another instance's possible work.
- Failure does not roll back parent directories created by the operation.

## Core boundary, permissions, audit, and errors

`main/service.ts` revalidates the schema and owns path resolution, supported-format and encoding validation, per-target serialization, permission checks, audit, safe writing, cleanup, and stable error mapping. Adapters pass only business input plus actor, source metadata, and an optional `AbortSignal`.

The capability is `mutates: true`, `risk: "high"`, and checks `fs.write.outside-userdata` against the normalized actual target. Audit may include the actual path, source, outcome, format, encoding, and byte size. Normal logs contain no text, complete path, or raw operating-system error message.

Stable errors are `INVALID_PATH`, `UNSUPPORTED_EXTENSION`, `INVALID_ENCODING`, `TARGET_EXISTS`, `UNSAFE_TARGET`, `TARGET_CHANGED`, `PERMISSION_DENIED`, `ABORTED`, and `WRITE_FAILED`. Serialized errors contain `code`, a user-facing `message`, and `retryable`; only `TARGET_CHANGED` is explicitly retryable. Raw text and underlying exception details are never serialized.

An optional internal abort signal is not part of MCP or Workflow business schemas. Cancellation before commit cleans up and returns `ABORTED`. Once atomic commit succeeds, the operation returns success even if cancellation arrives afterward.

## System app

Register a built-in independent-window app that is visible in the app launcher and not pinned by default. Its form is not persisted.

Use `SystemAppWindowShell`, `ScrollArea`, and one centered shadcn task card. The form contains a large `文本内容` textarea, an editable `文件路径` InputGroup with a `选择` action, an `encoding` selector, an `覆盖已存在文件` switch, and a `写入文件` button. The native save dialog filters `.txt`, `.md`, and `.csv`, while the core remains authoritative. Do not provide a format selector, preview, explanatory copy, history, or App-level cancel button. Show only missing, running, success, and error state; success offers `在文件夹中显示`.

The new app never infers overwrite permission from a save-dialog return value. The user must enable the switch. The existing Text Extractor is a narrow compatibility exception: its immediate native-save flow delegates with `.txt`, `utf8`, and explicit overwrite enabled so its current UI behavior remains unchanged.

## MCP and Workflow

The MCP schema has `additionalProperties: false`, requires `text` and `path`, declares the two encoding values, and documents the default encoding, default no-overwrite behavior, automatic parent creation, supported extensions, exact-text behavior, and absence of a product text-length limit. It returns the shared result or serialized shared error.

The Workflow node configuration is `{ path, text, encoding, overwrite, variables }`. Both path and text use explicit variable binding and interpolation. The control input only triggers execution and never becomes implicit text input. Success returns the actual path as the primary output and the complete shared result as structured outputs. Its sharing contract declares the path as a local file dependency with write access and requires capability version `1.0.0`.

Adding the node increments the Workflow document schema minor version, adds a migration and historical fixture, and updates the Workflow schema contract. It does not change the Workflow share-package format version.

## Verification and documentation

Cover strict shared schemas, encoding byte accuracy, empty and long text, extension handling, recursive directories, canonical parent links, target types, overwrite and no-clobber behavior, concurrent-change rejection, per-target serialization, modes, abort and cleanup, permission/audit redaction, App interaction, IPC, MCP registration/dispatch, Workflow schema/share/execution, and Text Extractor compatibility.

Update the Synapse Workflow Skill guide/API reference and `RELEASE_NOTES_PENDING.md`. Run targeted desktop tests, desktop typecheck, IPC code generation verification, Workflow contract tests, and repository hard-constraint checks without starting a development server.
