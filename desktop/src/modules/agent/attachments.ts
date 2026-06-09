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

export function createPathAttachment(
  input: Omit<AgentDraftPathAttachment, "kind" | "name"> & { readonly name?: string },
): AgentDraftPathAttachment {
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
  const files = attachments.filter(
    (item): item is AgentDraftPathAttachment => item.kind === "path" && item.entryType === "file",
  )
  const folders = attachments.filter(
    (item): item is AgentDraftPathAttachment => item.kind === "path" && item.entryType === "directory",
  )

  for (const attachment of attachments) {
    if (attachment.kind !== "image") continue
    lines.push(nextImageLabel(imageIndex))
    imageIndex += 1
  }
  if (files.length > 0) {
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
