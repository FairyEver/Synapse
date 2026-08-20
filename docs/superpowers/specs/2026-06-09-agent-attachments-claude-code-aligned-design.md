# Agent Attachments Claude Code Aligned Design

Date: 2026-06-09

## Context

Synapse Agent conversations currently accept only text input in the composer, while Claude Code supports richer prompt input. The user wants Synapse to match Claude Code's behavior:

- images are pasted as positional image chips such as `[Image #1]` and sent to the model as visual input;
- files and folders are pasted as paths and become path context;
- Claude can inspect file and folder context through its normal tools instead of receiving arbitrary file bytes in the prompt.

This design focuses on the renderer Agent conversation path backed by the Claude Agent SDK. It does not implement a general cloud-drive attachment system.

## Official References

- Claude Code interactive mode documents image paste as a dedicated shortcut that inserts an `[Image #N]` chip into the prompt.
- Claude Agent SDK streaming input supports direct image attachments by yielding `SDKUserMessage` objects whose `message.content` is an array containing `image` content blocks.
- Claude Agent SDK TypeScript options include `additionalDirectories`, described as additional directories Claude can access.
- Claude Agent SDK built-in `Read` can read local text, image, PDF, and notebook files.
- Claude Code Desktop documents attached images, PDFs, and other files in the prompt area, but the desired Synapse behavior intentionally follows the user's observed Claude Code split: image direct input, file and folder path context.

## Goals

- Let users paste or select images in the Agent composer and send them directly to the Claude model.
- Let users paste or select files and folders and send them as path context.
- Preserve Claude Code's message model: images use `[Image #N]` in sent content and history, while draft attachments use compact file items in the composer.
- Support multiple images, files, and folders in one user turn.
- Preserve normal text prompts and quick-input behavior.
- Keep attachments scoped to the current draft until the user sends or removes them.
- Ensure project-external file and folder paths are readable by the SDK session when appropriate.
- Keep UI copy short and operational.

## Non-Goals

- Do not build a Synapse Drive-backed attachment library for Agent conversations.
- Do not upload arbitrary files to Anthropic Files API in this iteration.
- Do not base64 encode ordinary files, folders, PDFs, Office documents, or archives into the user message.
- Do not convert files before sending.
- Do not auto-ingest Knowledge Base raw sources.
- Do not implement file preview, image crop, OCR, PDF page selection, or folder tree browsing in the composer.
- Do not add renderer-side directory scanning beyond what is needed to display selected folder paths.
- Do not expose hidden implementation paths or secrets in logs, history, transcript export, or usage analysis.

## Hard Rules

- Images are model content. They must be sent through `image` content blocks in `SDKUserMessage.message.content`.
- Files and folders are path context. They must not be sent as image or document content blocks.
- A pasted image must remain distinguishable from a pasted file even if both originate from the clipboard.
- A file path or folder path outside the project must be handled through the SDK access model, using `additionalDirectories` for directories Claude needs to read.
- User-visible attachment history may show file names and paths, but logs and diagnostics must continue using existing redaction rules for secrets.
- Attachment data must not flow back through permission-card summaries as real tool input.
- Renderer must not use raw Electron APIs. File selection and privileged path checks go through typed preload bridge methods.

## Chosen Approach

Use a dual-track composer attachment model:

```text
Draft
  text: string
  imageAttachments: image bytes for direct model input
  pathAttachments: file and folder paths for Claude tool context
```

When the user sends a turn:

1. Renderer sends text plus attachment metadata to Electron.
2. Electron validates and normalizes attachments.
3. `ClaudeSDKSession.send()` builds a `SDKUserMessage`.
4. Image attachments become `image` content blocks before the text block.
5. File and folder attachments become a concise text preface listing paths.
6. Parent directories needed for external paths are included in `additionalDirectories` for the SDK session.

This matches Claude Code's split without depending on undocumented CLI internals.

## UI Design

Composer attachment display:

```text
[ 课堂内容.md      ] [ 作业范文       ] [ screen.png     ]  [>]
[ Markdown · 7 KB ] [ 文件夹         ] [ PNG · 120 KB   ]

[ textarea 输入消息 ]
[+] [片段] [知识库动作]                     [权限模式] [发送]
```

Attachment strip:

- render one fixed-height horizontal row without wrapping or a visible scrollbar;
- show overflow arrows only when more items exist in that direction;
- show the original file name on the first line and format plus size on the second line;
- show the remove icon button on item hover or keyboard focus;
- do not show per-type icons or explanatory labels;
- preserve insertion order.

Image items:

- use the original image file name when available, falling back to `[Image #N]`;
- derive the visible format from the supported image MIME type and show the byte size;
- continue using `[Image #N]` in sent content and conversation history.

Path items:

- show the file or folder name in the composer and retain the absolute path as the hover title;
- show a friendly format plus byte size for files; folders show `文件夹` without size;
- keep absolute paths unchanged in sent content, history, and SDK access handling;
- do not add explanatory helper copy.

Input methods:

- select multiple files from the `+` attachment menu;
- select multiple folders from the `+` attachment menu;
- paste image from clipboard;
- drag image into the conversation workspace;
- paste file or folder paths from clipboard;
- drag files or folders into the conversation workspace.

The `+` button opens a two-item menu with `附加文件` and `附加文件夹`. Both native pickers allow multiple selections, and repeated selections accumulate in the current draft. Electron cannot present one native dialog as both a file and directory selector on Windows and Linux, so the two-item menu is consistent across platforms. The main process resolves selected, pasted, and dropped paths with `lstat`; Renderer does not infer directory type from file size or MIME metadata. Supported selected images remain direct model image content.

Use existing shadcn/Radix components, lucide icons, and theme token classes. Do not add custom colors, gradients, glow, page-specific CSS, nested cards, or marketing copy.

## Data Model

Renderer draft types should be explicit:

```ts
type AgentDraftAttachment =
  | {
      kind: "image"
      id: string
      name?: string
      mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
      size: number
      bytes: ArrayBuffer
    }
  | {
      kind: "path"
      id: string
      path: string
      entryType: "file" | "directory"
      name: string
    }
```

Bridge payload should avoid ambiguous generic `kind: string` where possible. Electron-side runtime types can keep the existing `AgentAttachment` shape for compatibility, but should normalize into stricter internal unions before building SDK input.

## SDK Message Construction

Current `ClaudeSDKSession.send()` sends text only:

```ts
message: {
  role: "user",
  content: message.content,
}
```

The new behavior should construct content blocks when images exist:

```ts
message: {
  role: "user",
  content: [
    ...imageBlocks,
    { type: "text", text: composedText },
  ],
}
```

`composedText` includes path context before the user's text when file or folder paths exist:

```text
粘贴文件:
/Users/liyang/Desktop/课堂内容.md

粘贴文件夹:
/Users/liyang/Downloads/作业范文

<user text>
```

If there are no images, the SDK message may remain a plain string unless path context requires composing the prompt text. Keeping text-only turns as strings minimizes behavioral change.

## Path Access Strategy

Claude can only read files and folders it has access to. For path attachments:

- if the attached path is inside the current project `cwd`, no extra directory is needed;
- if the attached item is a file outside `cwd`, add its parent directory to `additionalDirectories`;
- if the attached item is a directory outside `cwd`, add that directory to `additionalDirectories`;
- de-duplicate directories and collapse children under an already added parent;
- keep paths absolute in the prompt text so Claude can call `Read`, `Glob`, or `Grep` directly.

`additionalDirectories` is session-level. New SDK sessions receive the complete initial directory set. The installed Claude Agent SDK exposes `Query.applyFlagSettings()`, so an existing live session is updated before the turn is sent. Because SDK flag settings are shallow-merged, every update must include the complete normalized and de-duplicated directory set. Only update the runtime state after the SDK call succeeds.

Dragging or pasting a path is explicit user authorization for that attachment directory. Plain message text is not parsed for paths and does not grant access. If the SDK later requests permission for an external path, preserve its `addDirectories` suggestion server-side and expose only the blocked path plus whether session authorization is available. “允许一次” keeps the existing one-time decision; “本会话允许” returns only filtered `addDirectories` updates with `destination: "session"`. Never infer a directory from text or the blocked path, accept a directory from Renderer, or write the grant to Claude settings files.

## Electron Validation

Electron should validate path attachments before sending:

- resolve and normalize absolute paths;
- reject missing paths;
- detect file versus directory with `lstat`;
- reject symlink traversal unless an explicit future design allows it;
- avoid recursively scanning directory contents in the composer path;
- record only metadata needed for display and SDK access.

Image validation:

- allow JPEG, PNG, GIF, and WebP;
- enforce a conservative per-image size limit before base64 conversion;
- preserve raw base64 without a `data:image/...;base64,` prefix;
- keep image ordering stable;
- reject empty or invalid image bytes before sending to SDK.

Size limits should be explicit constants in implementation. If placed in `desktop/config.ts`, each constant must include a Chinese comment per repository rules.

## Persistence And History

Conversation history should preserve what the user sent in a readable way:

- text prompt remains visible as before;
- image attachments are represented by chips such as `[Image #1]`, not raw base64;
- file and folder attachments show their paths;
- transcript export should include the same concise representation;
- usage analysis and raw event display must not expose image base64.

The system does not need to persist image bytes for replay in this iteration unless existing conversation persistence requires exact SDK replay. If exact replay is required later, store image bytes in a controlled attachment store and never in display text.

## Error Handling

- If an image is too large or unsupported, keep it in draft and show a short error.
- If a path no longer exists before send, remove or block that attachment with a short error.
- If a folder path cannot be granted to the SDK, block send rather than silently sending an unreadable path.
- If `additionalDirectories` update fails for an existing session, surface a concise failure and do not enqueue the turn.
- If image conversion fails, do not send a partial turn.
- If only attachments are present and text is empty, allow sending when at least one image or path attachment exists.

## Testing

Add focused tests for:

- pasted image creates a compact composer item and sends an SDK `image` content block;
- multiple images preserve order and numbering;
- image block data is raw base64 without data URL prefix;
- pasted file path is included in composed text and not converted to a content block;
- pasted folder path is included in composed text and not converted to a content block;
- external file adds parent directory to `additionalDirectories`;
- external folder adds the folder path to `additionalDirectories`;
- project-internal path does not add an extra directory;
- duplicate or nested external directories are collapsed;
- text-only messages keep existing behavior;
- attachment-only messages can be sent;
- attachment menu file and folder selections preserve order and accumulate in the draft;
- cancelled native attachment selection leaves the draft unchanged;
- copied and dropped folders are classified by main-process path metadata;
- files and folders dropped anywhere in the conversation workspace reach the composer;
- invalid image and missing path block send;
- history and transcript show `[Image #N]` and paths but not base64;
- permission and tool event redaction still preserves normal paths while hiding secrets.

## Release Note

Implementation should update `RELEASE_NOTES_PENDING.md` because this is user-visible:

```text
Agent 对话支持按 Claude Code 的方式携带上下文：图片会作为视觉输入直接发送给模型，文件和文件夹会作为路径上下文交给 Claude 读取。
```
