# Agent Attachments Claude Code Aligned Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Claude Code aligned Agent attachments: images go directly to the model, files and folders are sent as path context.

**Architecture:** Keep the composer as the only visible UI surface for this iteration. Add small shared attachment types and helpers, pass attachments through the existing `synapse:agent:send` IPC method, normalize them in Electron, and make `ClaudeSDKSession` construct SDK user messages from the normalized attachments. Use `additionalDirectories` only for project-external file and folder paths available when a new SDK session is created.

**Tech Stack:** Electron, React, TypeScript, zod, Claude Agent SDK, Vitest, shadcn/Radix primitives, Tailwind token utilities.

---

## File Structure

- Create `desktop/src/modules/agent/attachments.ts`
  - Renderer-facing attachment types.
  - Helpers for image numbering, display labels, prompt summary text, and duplicate path removal.
- Modify `desktop/src/modules/agent/components/agent-composer-input-box.tsx`
  - Add an `attachments` slot above the textarea and below pending messages/context notice.
- Modify `desktop/src/modules/agent/components/agent-composer.tsx`
  - Own draft attachments.
  - Handle paste/drop.
  - Render attachment row.
  - Allow attachment-only submit.
  - Do not add any choose-file, choose-folder, or choose-image button.
- Modify `desktop/src/modules/agent/hooks/use-chat-connection.ts`
  - Accept attachments in `sendMessage`.
  - Render optimistic user timeline content with `[Image #N]` and paths.
  - Send attachments to the bridge.
- Modify `desktop/src/modules/agent/index.tsx`
  - Thread `sendMessage` and `canSend` changes through the Agent module.
- Modify `desktop/src/types/agent.ts`
  - Add shared renderer timeline metadata only if needed. Prefer no timeline schema expansion in this iteration; use readable content text.
- Modify `desktop/src/types/bridge.ts`
  - Add `attachments?: SynapseAgentSendAttachment[]` to `agent.send`.
- Modify `desktop/electron/modules/agent/ipc-messages.ts`
  - Extend `send` request schema for image and path attachments.
- Modify `desktop/electron/modules/agent/__tests__/ipc-event-schema.test.ts` or add `desktop/electron/modules/agent/__tests__/ipc-messages.test.ts`
  - Validate send schema accepts images and paths and rejects malformed attachments.
- Modify `desktop/electron/services/agent-runtime/types.ts`
  - Replace loose `AgentAttachment.kind: string` usage with a stricter union while keeping compatibility at the edge.
- Create `desktop/electron/services/agent-runtime/attachments.ts`
  - Normalize image/path attachments.
  - Compose user-visible path context text.
  - Build SDK content blocks.
  - Compute `additionalDirectories` for new SDK sessions.
- Modify `desktop/electron/services/agent-runtime/claude-sdk-session.ts`
  - Use attachment helper in `send()`.
  - Accept `additionalDirectories` from session options.
- Modify `desktop/electron/services/agent-runtime/session-manager.ts`
  - Pass first-turn `additionalDirectories` into new `ClaudeSDKSession` options.
  - For existing live sessions, block new project-external path attachments with a clear error until a verified runtime directory update exists.
- Modify `desktop/electron/services/agent-runtime/conversation-router.ts`
  - Persist readable user message text that includes image chips and path context, never image base64.
- Modify `desktop/src/lib/agent-transcript.ts` and `desktop/src/lib/agent-timeline.ts`
  - Usually no code change beyond tests if readable content is persisted. Only update if existing filters drop attachment-only messages.
- Modify `RELEASE_NOTES_PENDING.md`
  - Add a user-facing release note.

## Task 1: Renderer Attachment Helpers

**Files:**
- Create: `desktop/src/modules/agent/attachments.ts`
- Test: `desktop/src/modules/agent/__tests__/attachments.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `desktop/src/modules/agent/__tests__/attachments.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  createImageAttachment,
  createPathAttachment,
  formatDraftAttachmentsForMessage,
  nextImageLabel,
} from "../attachments"

describe("agent attachment helpers", () => {
  it("labels images using Claude Code style numbering", () => {
    expect(nextImageLabel(0)).toBe("[Image #1]")
    expect(nextImageLabel(2)).toBe("[Image #3]")
  })

  it("formats images and paths into readable user message content", () => {
    const image = createImageAttachment({
      id: "img-1",
      mimeType: "image/png",
      size: 10,
      bytes: new ArrayBuffer(3),
    })
    const file = createPathAttachment({
      id: "path-1",
      path: "/Users/liyang/Desktop/课堂内容.md",
      entryType: "file",
    })
    const folder = createPathAttachment({
      id: "path-2",
      path: "/Users/liyang/Downloads/作业范文",
      entryType: "directory",
    })

    expect(formatDraftAttachmentsForMessage("请分析", [image, file, folder])).toBe([
      "[Image #1]",
      "粘贴文件:",
      "/Users/liyang/Desktop/课堂内容.md",
      "",
      "粘贴文件夹:",
      "/Users/liyang/Downloads/作业范文",
      "",
      "请分析",
    ].join("\n"))
  })

  it("allows attachment-only readable content", () => {
    const image = createImageAttachment({
      id: "img-1",
      mimeType: "image/webp",
      size: 10,
      bytes: new ArrayBuffer(3),
    })

    expect(formatDraftAttachmentsForMessage("", [image])).toBe("[Image #1]")
  })
})
```

- [ ] **Step 2: Run helper test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/agent/__tests__/attachments.test.ts
```

Expected: FAIL because `desktop/src/modules/agent/attachments.ts` does not exist.

- [ ] **Step 3: Implement renderer helper**

Create `desktop/src/modules/agent/attachments.ts`:

```ts
export type AgentDraftImageAttachment = {
  readonly kind: "image"
  readonly id: string
  readonly name?: string
  readonly mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
  readonly size: number
  readonly bytes: ArrayBuffer
}

export type AgentDraftPathAttachment = {
  readonly kind: "path"
  readonly id: string
  readonly path: string
  readonly entryType: "file" | "directory"
  readonly name: string
}

export type AgentDraftAttachment = AgentDraftImageAttachment | AgentDraftPathAttachment

export function nextImageLabel(index: number): string {
  return `[Image #${index + 1}]`
}

export function createImageAttachment(input: Omit<AgentDraftImageAttachment, "kind">): AgentDraftImageAttachment {
  return { ...input, kind: "image" }
}

export function createPathAttachment(input: Omit<AgentDraftPathAttachment, "kind" | "name"> & { readonly name?: string }): AgentDraftPathAttachment {
  return {
    ...input,
    kind: "path",
    name: input.name ?? input.path.split(/[\\/]/).filter(Boolean).at(-1) ?? input.path,
  }
}

export function formatDraftAttachmentsForMessage(
  text: string,
  attachments: readonly AgentDraftAttachment[],
): string {
  const lines: string[] = []
  let imageIndex = 0
  const files = attachments.filter((item): item is AgentDraftPathAttachment => item.kind === "path" && item.entryType === "file")
  const folders = attachments.filter((item): item is AgentDraftPathAttachment => item.kind === "path" && item.entryType === "directory")

  for (const attachment of attachments) {
    if (attachment.kind !== "image") continue
    lines.push(nextImageLabel(imageIndex))
    imageIndex += 1
  }
  if (files.length > 0) {
    if (lines.length > 0) lines.push("")
    lines.push("粘贴文件:", ...files.map((item) => item.path))
  }
  if (folders.length > 0) {
    if (lines.length > 0) lines.push("")
    lines.push("粘贴文件夹:", ...folders.map((item) => item.path))
  }
  const trimmed = text.trim()
  if (trimmed) {
    if (lines.length > 0) lines.push("")
    lines.push(trimmed)
  }
  return lines.join("\n")
}
```

- [ ] **Step 4: Run helper test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/agent/__tests__/attachments.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/agent/attachments.ts desktop/src/modules/agent/__tests__/attachments.test.ts
git commit -m "test(agent): add attachment formatting helpers"
```

## Task 2: Composer Paste, Drag, Row, Delete

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-composer-input-box.tsx`
- Modify: `desktop/src/modules/agent/components/agent-composer.tsx`
- Test: `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`

- [ ] **Step 1: Write failing composer tests**

Append tests to `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`. Use the existing render helpers in that file; if the file already has a `renderComposer` helper, add `attachments` assertions through that helper instead of duplicating setup.

```tsx
it("adds pasted images as Claude Code style image chips without rendering picker buttons", async () => {
  const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
  const { container } = renderComposer({
    draft: "",
    canSend: true,
    onSubmit,
  })
  const textarea = container.querySelector("textarea")
  expect(textarea).toBeTruthy()

  const file = new File(["png"], "screen.png", { type: "image/png" })
  fireEvent.paste(textarea!, {
    clipboardData: {
      files: [file],
      items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
      getData: () => "",
    },
  })

  expect(container.textContent).toContain("[Image #1]")
  expect(container.querySelector('[aria-label="选择图片"]')).toBeNull()
  expect(container.querySelector('[aria-label="选择文件"]')).toBeNull()
})

it("adds dropped file and folder paths as removable path rows", async () => {
  const { container } = renderComposer({
    draft: "",
    canSend: true,
  })
  const form = container.querySelector("form")
  expect(form).toBeTruthy()

  const file = new File(["notes"], "课堂内容.md", { type: "text/markdown" }) as File & { path?: string }
  file.path = "/Users/liyang/Desktop/课堂内容.md"
  const folder = new File([], "作业范文") as File & { path?: string }
  folder.path = "/Users/liyang/Downloads/作业范文"

  fireEvent.drop(form!, {
    dataTransfer: {
      files: [file, folder],
      items: [],
    },
  })

  expect(container.textContent).toContain("/Users/liyang/Desktop/课堂内容.md")
  expect(container.textContent).toContain("/Users/liyang/Downloads/作业范文")

  const removeButtons = container.querySelectorAll('button[aria-label^="删除附件"]')
  expect(removeButtons).toHaveLength(2)
  fireEvent.click(removeButtons[0])
  expect(container.textContent).not.toContain("/Users/liyang/Desktop/课堂内容.md")
})

it("allows submit when attachments exist and text is empty", () => {
  const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
  const { container } = renderComposer({
    draft: "",
    canSend: true,
    onSubmit,
  })
  const textarea = container.querySelector("textarea")
  const file = new File(["png"], "screen.png", { type: "image/png" })

  fireEvent.paste(textarea!, {
    clipboardData: {
      files: [file],
      items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
      getData: () => "",
    },
  })
  fireEvent.submit(container.querySelector("form")!)

  expect(onSubmit).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run composer tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: FAIL because composer has no attachment state, paste/drop handling, or attachment row.

- [ ] **Step 3: Add attachments slot to input box**

Modify `desktop/src/modules/agent/components/agent-composer-input-box.tsx`:

```tsx
type AgentComposerInputBoxProps = {
  readonly editor: ReactNode
  readonly leadingActions: ReactNode
  readonly trailingActions: ReactNode
  readonly multiline?: boolean
  readonly pendingMessages?: ReactNode
  readonly contextNotice?: ReactNode
  readonly slashMenu?: ReactNode
  readonly attachments?: ReactNode
}
```

Render the slot before the editor:

```tsx
        {attachments ? (
          <div className="agent-composer-input-box__attachments border-b border-border px-1 pb-2">
            {attachments}
          </div>
        ) : null}
        <div className="agent-composer-input-box__editor min-h-0 flex-1">
          {editor}
        </div>
```

- [ ] **Step 4: Add composer attachment state and handlers**

Modify `desktop/src/modules/agent/components/agent-composer.tsx` imports:

```tsx
import { FileIcon, FolderIcon, ImageIcon, X } from "lucide-react"
import {
  createImageAttachment,
  createPathAttachment,
  formatDraftAttachmentsForMessage,
  nextImageLabel,
  type AgentDraftAttachment,
} from "../attachments"
```

Add state and helpers inside `AgentComposer`:

```tsx
  const [attachments, setAttachments] = useState<AgentDraftAttachment[]>([])

  const addAttachments = (next: readonly AgentDraftAttachment[]) => {
    if (next.length === 0) return
    setAttachments((current) => [...current, ...next])
  }

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id))
  }

  const attachmentMessageContent = formatDraftAttachmentsForMessage(draft, attachments)
  const attachmentAwareCanSend = canSend || attachments.length > 0
```

Add paste/drop handlers using existing React events:

```tsx
  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData.items ?? [])
    const images = items
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
      .map((file) => createImageAttachment({
        id: crypto.randomUUID(),
        name: file.name || undefined,
        mimeType: file.type as AgentDraftImageAttachment["mimeType"],
        size: file.size,
        bytes: new ArrayBuffer(0),
      }))
    if (images.length > 0) {
      event.preventDefault()
      addAttachments(images)
    }
  }

  const handleDrop = (event: React.DragEvent<HTMLFormElement>) => {
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length === 0) return
    event.preventDefault()
    addAttachments(files.map((file) => {
      const maybePath = (file as File & { path?: string }).path || file.name
      return file.type.startsWith("image/")
        ? createImageAttachment({
            id: crypto.randomUUID(),
            name: file.name || undefined,
            mimeType: file.type as AgentDraftImageAttachment["mimeType"],
            size: file.size,
            bytes: new ArrayBuffer(0),
          })
        : createPathAttachment({
            id: crypto.randomUUID(),
            path: maybePath,
            entryType: file.size === 0 && !file.type ? "directory" : "file",
          })
    }))
  }
```

During actual implementation, replace `new ArrayBuffer(0)` with `await file.arrayBuffer()` in an async helper. Keep this code in the plan as the shape reference; do not send zero-byte image data in final implementation.

Update submit and clear attachments only after submit is accepted by parent:

```tsx
  const handleSubmit = (event: FormEvent) => {
    track({
      component: "agent",
      name: "agent-message-submit",
      action: "submit",
      metadata: {
        boundary: "renderer.agent.composer-submit",
        draftLength: draft.trim().length,
        attachmentCount: attachments.length,
        canSend: attachmentAwareCanSend,
        sending,
        pendingCount: pendingMessages.length,
        permissionMode,
      },
    })
    onSubmit(event, attachments, attachmentMessageContent)
  }
```

If changing `onSubmit` signature is too invasive, keep `onSubmit(event)` and expose attachments through a new prop `onSubmitAttachments`. Pick one path in implementation and update tests accordingly.

Render the attachment row:

```tsx
          attachments={attachments.length > 0 ? (
            <div className="flex flex-col gap-1">
              {attachments.map((attachment, index) => (
                <div key={attachment.id} className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 text-sm">
                  {attachment.kind === "image" ? <ImageIcon className="size-4 text-muted-foreground" /> : attachment.entryType === "directory" ? <FolderIcon className="size-4 text-muted-foreground" /> : <FileIcon className="size-4 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 truncate">
                    {attachment.kind === "image" ? nextImageLabel(attachments.slice(0, index + 1).filter((item) => item.kind === "image").length - 1) : attachment.path}
                  </span>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={`删除附件 ${attachment.kind === "image" ? nextImageLabel(index) : attachment.name}`} onClick={() => removeAttachment(attachment.id)}>
                    <X />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
```

Use only token utility classes and existing components.

- [ ] **Step 5: Run composer tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/agent/components/agent-composer-input-box.tsx desktop/src/modules/agent/components/agent-composer.tsx desktop/src/modules/agent/__tests__/agent-composer.test.tsx
git commit -m "feat(agent): show pasted and dropped attachments"
```

## Task 3: Bridge Payload And Hook Send Flow

**Files:**
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/src/modules/agent/hooks/use-chat-connection.ts`
- Modify: `desktop/src/modules/agent/index.tsx`
- Test: `desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx`

- [ ] **Step 1: Write failing hook test**

Add a test to `desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx`:

```tsx
it("sends attachment-only messages with readable optimistic content", async () => {
  const bridge = (window as unknown as {
    synapse: {
      agent: {
        send: ReturnType<typeof vi.fn>
      }
    }
  }).synapse.agent
  bridge.send.mockResolvedValue(undefined)
  let chat: ReturnType<typeof useAgentChat> | undefined
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<HookProbe onChange={(next) => { chat = next }} />)
  })
  await waitFor(() => chat?.selectedConversationId === session.id)

  const sent = await act(async () => chat?.sendMessage("", {
    projectId: session.projectId,
    conversationId: session.id,
    sessionKey: session.sessionKey,
    attachments: [{
      kind: "path",
      id: "path-1",
      path: "/Users/liyang/Desktop/课堂内容.md",
      entryType: "file",
      name: "课堂内容.md",
    }],
  } as never))

  expect(sent).toBe(true)
  expect(chat?.timeline.at(-1)).toMatchObject({
    kind: "message",
    role: "user",
    content: "粘贴文件:\n/Users/liyang/Desktop/课堂内容.md",
  })
  expect(bridge.send).toHaveBeenCalledWith(expect.objectContaining({
    content: "",
    attachments: [expect.objectContaining({
      kind: "path",
      path: "/Users/liyang/Desktop/课堂内容.md",
    })],
  }))
})
```

- [ ] **Step 2: Run hook test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx
```

Expected: FAIL because `sendMessage` rejects empty content and has no attachments argument.

- [ ] **Step 3: Extend bridge and hook types**

Modify `desktop/src/types/bridge.ts`:

```ts
export type SynapseAgentSendAttachment =
  | {
      readonly kind: "image"
      readonly id?: string
      readonly name?: string
      readonly mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
      readonly size: number
      readonly base64: string
    }
  | {
      readonly kind: "path"
      readonly id?: string
      readonly path: string
      readonly entryType: "file" | "directory"
      readonly name?: string
    }
```

Then add to `agent.send` args:

```ts
attachments?: readonly SynapseAgentSendAttachment[]
```

Modify `SendMessageTarget` in `use-chat-connection.ts`:

```ts
type SendMessageTarget = TimelineTarget & {
  readonly attachments?: readonly AgentDraftAttachment[]
}
```

Also change `ChatConnectionResult.sendMessage` to accept:

```ts
readonly sendMessage: (
  content: string,
  target?: SendMessageTarget,
) => Promise<boolean>
```

- [ ] **Step 4: Implement attachment-aware send**

In `use-chat-connection.ts`, replace:

```ts
const trimmed = content.trim()
if (!trimmed) return false
```

with:

```ts
const trimmed = content.trim()
const attachments = target?.attachments ?? []
if (!trimmed && attachments.length === 0) return false
const visibleContent = formatDraftAttachmentsForMessage(trimmed, attachments)
```

Use `visibleContent` for `localUserTimelineItem` and `trimmed` for the raw bridge `content`:

```ts
const optimisticItem = localUserTimelineItem(visibleContent, now, state.timeline.length)
await bridge.agent.send({
  projectId,
  sessionKey,
  conversationId,
  content: trimmed,
  attachments: serializeSendAttachments(attachments),
  clientSubmittedAt: now,
})
```

Add local serializer:

```ts
function serializeSendAttachments(attachments: readonly AgentDraftAttachment[]): SynapseAgentSendAttachment[] {
  return attachments.map((attachment) => {
    if (attachment.kind === "path") {
      return {
        kind: "path",
        id: attachment.id,
        path: attachment.path,
        entryType: attachment.entryType,
        name: attachment.name,
      }
    }
    return {
      kind: "image",
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      base64: arrayBufferToBase64(attachment.bytes),
    }
  })
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return window.btoa(binary)
}
```

- [ ] **Step 5: Thread attachments from `AgentModule` submit**

In `desktop/src/modules/agent/index.tsx`, update the composer submit handler to pass draft attachments to `chat.sendMessage`. Keep the final user-visible UI exactly as Task 2 specifies and do not add picker buttons.

Expected shape:

```tsx
const handleComposerSubmit = async (
  event: FormEvent,
  attachments: readonly AgentDraftAttachment[] = [],
) => {
  event.preventDefault()
  const sent = await chat.sendMessage(draft, {
    projectId: selectedProjectId,
    conversationId: selectedConversationId,
    sessionKey: selectedSessionKey,
    attachments,
  })
  if (sent) setDraft("")
}
```

If the existing submit handler has a different name, update that handler only.

- [ ] **Step 6: Run hook tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/types/bridge.ts desktop/src/modules/agent/hooks/use-chat-connection.ts desktop/src/modules/agent/index.tsx desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx
git commit -m "feat(agent): send draft attachments through bridge"
```

## Task 4: IPC Schema And Runtime Attachment Normalization

**Files:**
- Modify: `desktop/electron/modules/agent/ipc-messages.ts`
- Modify: `desktop/electron/services/agent-runtime/types.ts`
- Create: `desktop/electron/services/agent-runtime/attachments.ts`
- Test: `desktop/electron/modules/agent/__tests__/ipc-messages.test.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/attachments.test.ts`

- [ ] **Step 1: Write failing IPC and runtime tests**

Create `desktop/electron/modules/agent/__tests__/ipc-messages.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { messageMethods } from "../ipc-messages"

describe("agent message IPC schemas", () => {
  it("accepts image and path attachments in send requests", () => {
    expect(messageMethods.send.request.safeParse({
      projectId: "project-1",
      content: "",
      attachments: [{
        kind: "image",
        mimeType: "image/png",
        size: 3,
        base64: "cG5n",
      }, {
        kind: "path",
        path: "/Users/liyang/Desktop/课堂内容.md",
        entryType: "file",
      }],
    }).success).toBe(true)
  })

  it("rejects malformed image attachments", () => {
    expect(messageMethods.send.request.safeParse({
      projectId: "project-1",
      content: "",
      attachments: [{
        kind: "image",
        mimeType: "text/plain",
        size: 3,
        base64: "cG5n",
      }],
    }).success).toBe(false)
  })
})
```

Create `desktop/electron/services/agent-runtime/__tests__/attachments.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  buildClaudeUserMessageContent,
  directoriesForPathAttachments,
  normalizeAgentAttachments,
} from "../attachments"

describe("agent runtime attachments", () => {
  it("builds image content blocks and path text without leaking base64 into text", () => {
    const attachments = normalizeAgentAttachments([{
      kind: "image",
      mimeType: "image/png",
      size: 3,
      base64: "cG5n",
    }, {
      kind: "path",
      path: "/Users/liyang/Desktop/课堂内容.md",
      entryType: "file",
    }])

    const content = buildClaudeUserMessageContent("请分析", attachments)

    expect(content).toEqual([
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "cG5n",
        },
      },
      {
        type: "text",
        text: "粘贴文件:\n/Users/liyang/Desktop/课堂内容.md\n\n请分析",
      },
    ])
    expect(JSON.stringify(content)).toContain("cG5n")
    expect((content[1] as { text: string }).text).not.toContain("cG5n")
  })

  it("computes additional directories only for project-external paths", () => {
    const attachments = normalizeAgentAttachments([{
      kind: "path",
      path: "/Users/liyang/project/a.md",
      entryType: "file",
    }, {
      kind: "path",
      path: "/Users/liyang/Desktop/outside.md",
      entryType: "file",
    }, {
      kind: "path",
      path: "/Users/liyang/Downloads/作业范文",
      entryType: "directory",
    }])

    expect(directoriesForPathAttachments({
      cwd: "/Users/liyang/project",
      attachments,
    })).toEqual([
      "/Users/liyang/Desktop",
      "/Users/liyang/Downloads/作业范文",
    ])
  })
})
```

- [ ] **Step 2: Run IPC/runtime tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/modules/agent/__tests__/ipc-messages.test.ts desktop/electron/services/agent-runtime/__tests__/attachments.test.ts
```

Expected: FAIL because schemas and helper module do not exist.

- [ ] **Step 3: Extend IPC schema**

Modify `desktop/electron/modules/agent/ipc-messages.ts`:

```ts
const agentImageAttachmentSchema = z.object({
  kind: z.literal("image"),
  id: z.string().optional(),
  name: z.string().optional(),
  mimeType: z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]),
  size: z.number().int().nonnegative(),
  base64: z.string().min(1),
})

const agentPathAttachmentSchema = z.object({
  kind: z.literal("path"),
  id: z.string().optional(),
  name: z.string().optional(),
  path: z.string().min(1),
  entryType: z.enum(["file", "directory"]),
})

const agentSendAttachmentSchema = z.discriminatedUnion("kind", [
  agentImageAttachmentSchema,
  agentPathAttachmentSchema,
])
```

Add to the existing send request:

```ts
attachments: z.array(agentSendAttachmentSchema).optional(),
```

Update the handler to pass `attachments` into `service.send`.

- [ ] **Step 4: Implement runtime helper**

Create `desktop/electron/services/agent-runtime/attachments.ts`:

```ts
import path from "node:path"

import type { AgentAttachment } from "./types"

export type NormalizedAgentAttachment =
  | {
      readonly kind: "image"
      readonly name?: string
      readonly mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
      readonly size: number
      readonly base64: string
    }
  | {
      readonly kind: "path"
      readonly path: string
      readonly entryType: "file" | "directory"
      readonly name?: string
    }

export function normalizeAgentAttachments(
  attachments: readonly AgentAttachment[] | undefined,
): NormalizedAgentAttachment[] {
  if (!attachments) return []
  return attachments.flatMap((attachment) => {
    if (attachment.kind === "image" && isImageMimeType(attachment.mimeType) && typeof attachment.metadata?.base64 === "string") {
      return [{
        kind: "image" as const,
        name: typeof attachment.metadata.name === "string" ? attachment.metadata.name : undefined,
        mimeType: attachment.mimeType,
        size: typeof attachment.metadata.size === "number" ? attachment.metadata.size : 0,
        base64: attachment.metadata.base64,
      }]
    }
    if (attachment.kind === "path" && typeof attachment.path === "string") {
      const entryType = attachment.metadata?.entryType === "directory" ? "directory" : "file"
      return [{
        kind: "path" as const,
        path: path.resolve(attachment.path),
        entryType,
        name: typeof attachment.metadata?.name === "string" ? attachment.metadata.name : undefined,
      }]
    }
    return []
  })
}

export function buildClaudeUserMessageContent(
  text: string,
  attachments: readonly NormalizedAgentAttachment[],
): string | Array<Record<string, unknown>> {
  const images = attachments.filter((item) => item.kind === "image")
  const composedText = composeAttachmentText(text, attachments)
  if (images.length === 0) return composedText
  return [
    ...images.map((image) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mimeType,
        data: image.base64,
      },
    })),
    { type: "text", text: composedText },
  ]
}

export function composeAttachmentText(
  text: string,
  attachments: readonly NormalizedAgentAttachment[],
): string {
  const files = attachments.filter((item) => item.kind === "path" && item.entryType === "file")
  const folders = attachments.filter((item) => item.kind === "path" && item.entryType === "directory")
  const lines: string[] = []
  if (files.length > 0) lines.push("粘贴文件:", ...files.map((item) => item.path))
  if (folders.length > 0) {
    if (lines.length > 0) lines.push("")
    lines.push("粘贴文件夹:", ...folders.map((item) => item.path))
  }
  const trimmed = text.trim()
  if (trimmed) {
    if (lines.length > 0) lines.push("")
    lines.push(trimmed)
  }
  return lines.join("\n")
}

export function directoriesForPathAttachments(input: {
  readonly cwd: string
  readonly attachments: readonly NormalizedAgentAttachment[]
}): string[] {
  const cwd = path.resolve(input.cwd)
  const candidates = input.attachments.flatMap((attachment) => {
    if (attachment.kind !== "path") return []
    const resolved = path.resolve(attachment.path)
    if (isInside(resolved, cwd)) return []
    return attachment.entryType === "directory" ? [resolved] : [path.dirname(resolved)]
  })
  return collapseDirectories([...new Set(candidates)])
}

function isImageMimeType(value: unknown): value is "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  return value === "image/jpeg" || value === "image/png" || value === "image/gif" || value === "image/webp"
}

function isInside(filePath: string, root: string): boolean {
  const relative = path.relative(root, filePath)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function collapseDirectories(dirs: readonly string[]): string[] {
  const sorted = [...dirs].map((dir) => path.resolve(dir)).sort()
  const out: string[] = []
  for (const dir of sorted) {
    if (out.some((existing) => isInside(dir, existing))) continue
    out.push(dir)
  }
  return out
}
```

Adjust `normalizeAgentAttachments` input mapping to match the exact `AgentAttachment` union added in `types.ts`; the above shows required behavior.

- [ ] **Step 5: Tighten AgentAttachment type**

Modify `desktop/electron/services/agent-runtime/types.ts`:

```ts
export type AgentAttachment =
  | {
      readonly kind: "image"
      readonly path?: never
      readonly mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
      readonly metadata: {
        readonly base64: string
        readonly size: number
        readonly name?: string
      }
    }
  | {
      readonly kind: "path"
      readonly path: string
      readonly mimeType?: string
      readonly metadata: {
        readonly entryType: "file" | "directory"
        readonly name?: string
      }
    }
```

Update IPC handler mapping so bridge `base64` and `size` become `metadata.base64` and `metadata.size`.

- [ ] **Step 6: Run IPC/runtime tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/modules/agent/__tests__/ipc-messages.test.ts desktop/electron/services/agent-runtime/__tests__/attachments.test.ts
```

Expected: PASS.

- [ ] **Step 7: Generate IPC artifacts**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

Expected: generated IPC channel/type files update or remain unchanged except for schema-derived artifacts.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/modules/agent/ipc-messages.ts desktop/electron/modules/agent/__tests__/ipc-messages.test.ts desktop/electron/services/agent-runtime/types.ts desktop/electron/services/agent-runtime/attachments.ts desktop/electron/services/agent-runtime/__tests__/attachments.test.ts desktop/electron/generated desktop/src/types/bridge.ts
git commit -m "feat(agent): normalize send attachments"
```

## Task 5: SDK Message Construction And Directory Access

**Files:**
- Modify: `desktop/electron/services/agent-runtime/claude-sdk-session.ts`
- Modify: `desktop/electron/services/agent-runtime/session-manager.ts`
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/session-manager.test.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts`

- [ ] **Step 1: Write failing SDK session tests**

Add to `desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts`:

```ts
it("sends image attachments as SDK image content blocks", async () => {
  const { factory, getPrompt } = createQueryFactory()
  const session = createSession(factory)

  const input = getPrompt()[Symbol.asyncIterator]().next()
  await session.send({
    ...message("请看图"),
    attachments: [{
      kind: "image",
      mimeType: "image/png",
      metadata: {
        base64: "cG5n",
        size: 3,
      },
    }],
  })

  await expect(input).resolves.toMatchObject({
    done: false,
    value: {
      type: "user",
      message: {
        role: "user",
        content: [{
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "cG5n",
          },
        }, {
          type: "text",
          text: "请看图",
        }],
      },
    },
  })
})

it("sets additional directories on new SDK sessions", () => {
  const { factory, getOptions } = createQueryFactory()
  createSession(factory, {
    additionalDirectories: ["/Users/liyang/Desktop"],
  } as never)

  expect(getOptions()).toMatchObject({
    additionalDirectories: ["/Users/liyang/Desktop"],
  })
})
```

- [ ] **Step 2: Run SDK session tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts
```

Expected: FAIL because `ClaudeSDKSession` ignores attachments and has no `additionalDirectories` option.

- [ ] **Step 3: Implement SDK content construction**

Modify `desktop/electron/services/agent-runtime/claude-sdk-session.ts`:

```ts
import {
  buildClaudeUserMessageContent,
  normalizeAgentAttachments,
} from "./attachments"
```

Extend `ClaudeSDKSessionOptions`:

```ts
readonly additionalDirectories?: readonly string[]
```

Replace `send()` content creation:

```ts
const attachments = normalizeAgentAttachments(message.attachments)
this.inputQueue.push({
  type: "user",
  message: {
    role: "user",
    content: buildClaudeUserMessageContent(message.content, attachments) as never,
  },
  parent_tool_use_id: null,
})
```

In `buildQueryOptions()` add:

```ts
if (options.additionalDirectories?.length) {
  queryOptions.additionalDirectories = [...options.additionalDirectories]
}
```

- [ ] **Step 4: Add first-turn additionalDirectories in SessionManager**

Modify `desktop/electron/services/agent-runtime/session-manager.ts` so new session creation computes path directories from the first message:

```ts
import { directoriesForPathAttachments, normalizeAgentAttachments } from "./attachments"
```

When constructing `ClaudeSDKSessionOptions`, add:

```ts
additionalDirectories: directoriesForPathAttachments({
  cwd: resolvedCwd,
  attachments: normalizeAgentAttachments(input.message.attachments),
}),
```

Use the actual variable name for the resolved working directory in `session-manager.ts`.

- [ ] **Step 5: Handle existing live sessions conservatively**

In `conversation-router.ts` or `session-manager.ts`, before sending to an existing live session, detect external path attachments that require new directories. Since the currently documented `QueryLike` has no verified `addDirectories` method, block the turn with a clear error:

```ts
if (!sessionHandle.created && requiresNewAdditionalDirectories(message, conversationWorkspacePath)) {
  throw new Error("当前会话暂不支持新增项目外附件路径，请开启新会话后再发送。")
}
```

The helper should only block project-external path attachments. Images and project-internal paths must continue.

- [ ] **Step 6: Persist readable content**

In `conversation-router.ts`, before `appendHistory(conversation.id, "user", message.content)`, compose readable text from attachments:

```ts
const displayContent = composeAttachmentTextWithImageLabels(message.content, message.attachments)
const savedConversation = await this.repository.appendHistory(conversation.id, "user", displayContent)
```

The persisted text must include `[Image #N]` and path sections but never image base64. Reuse the runtime attachment helper rather than duplicating formatting.

- [ ] **Step 7: Run runtime tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts desktop/electron/services/agent-runtime/__tests__/session-manager.test.ts desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/services/agent-runtime/claude-sdk-session.ts desktop/electron/services/agent-runtime/session-manager.ts desktop/electron/services/agent-runtime/conversation-router.ts desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts desktop/electron/services/agent-runtime/__tests__/session-manager.test.ts desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts
git commit -m "feat(agent): pass attachments to Claude SDK"
```

## Task 6: Transcript, Release Note, And Verification

**Files:**
- Modify: `desktop/src/lib/__tests__/agent-transcript.test.ts`
- Modify: `desktop/src/lib/__tests__/agent-timeline.test.ts`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add transcript and timeline tests**

Add to `desktop/src/lib/__tests__/agent-transcript.test.ts`:

```ts
it("keeps attachment display text but not image bytes in transcripts", () => {
  const transcript = formatAgentTranscript([{
    id: "msg-1",
    kind: "message",
    role: "user",
    content: "[Image #1]\n\n粘贴文件:\n/Users/liyang/Desktop/课堂内容.md",
    timestamp: "2026-06-09T00:00:00.000Z",
  }])

  expect(transcript).toContain("[Image #1]")
  expect(transcript).toContain("/Users/liyang/Desktop/课堂内容.md")
  expect(transcript).not.toContain("base64")
  expect(transcript).not.toContain("cG5n")
})
```

Add to `desktop/src/lib/__tests__/agent-timeline.test.ts`:

```ts
it("does not drop attachment-only user messages", () => {
  const item = localUserTimelineItem("[Image #1]", "2026-06-09T00:00:00.000Z", 0)
  expect(item).toMatchObject({
    kind: "message",
    role: "user",
    content: "[Image #1]",
  })
})
```

- [ ] **Step 2: Run transcript/timeline tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/lib/__tests__/agent-transcript.test.ts desktop/src/lib/__tests__/agent-timeline.test.ts
```

Expected: PASS. If timeline filtering drops attachment-only messages, update `isEmptyTimelineItem()` to treat `[Image #1]` and path context as non-empty.

- [ ] **Step 3: Add release note**

Append to `RELEASE_NOTES_PENDING.md` in the existing style:

```md
- Agent 对话支持按 Claude Code 的方式携带上下文：图片会作为视觉输入直接发送给模型，文件和文件夹会作为路径上下文交给 Claude 读取。
```

- [ ] **Step 4: Run focused test suite**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/src/modules/agent/__tests__/attachments.test.ts \
  desktop/src/modules/agent/__tests__/agent-composer.test.tsx \
  desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx \
  desktop/electron/modules/agent/__tests__/ipc-messages.test.ts \
  desktop/electron/services/agent-runtime/__tests__/attachments.test.ts \
  desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts \
  desktop/electron/services/agent-runtime/__tests__/session-manager.test.ts \
  desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts \
  desktop/src/lib/__tests__/agent-transcript.test.ts \
  desktop/src/lib/__tests__/agent-timeline.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck and hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/lib/__tests__/agent-transcript.test.ts desktop/src/lib/__tests__/agent-timeline.test.ts RELEASE_NOTES_PENDING.md
git commit -m "test(agent): verify attachment transcript behavior"
```

## Self-Review Notes

- Spec coverage: image direct model input is covered by Tasks 2, 4, and 5; file/folder path context is covered by Tasks 1, 3, 4, and 5; no picker buttons is covered by Tasks 2 and 6; history/transcript safety is covered by Tasks 5 and 6.
- Placeholder scan: the plan contains no TODO/TBD placeholders. Runtime directory update is deliberately scoped as a verified implementation choice; current plan blocks existing live sessions for new external directories rather than guessing an unsupported SDK API.
- Type consistency: renderer `AgentDraftAttachment`, bridge `SynapseAgentSendAttachment`, Electron `AgentAttachment`, and runtime `NormalizedAgentAttachment` are intentionally separate boundary types.

