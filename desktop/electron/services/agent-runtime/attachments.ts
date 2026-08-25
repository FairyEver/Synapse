import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" }
import { createHash } from "node:crypto"
import path from "node:path"

import type {
  AgentAttachment,
  AgentMessage,
  AgentImageAttachment,
  AgentPathAttachment,
  AgentUserMessageImageArtifact,
} from "./types"

type SdkMessageContent = SDKUserMessage["message"]["content"]
type SdkContentBlocks = Exclude<SdkMessageContent, string>
type PathFlavor = "posix" | "win32"

export type AgentAttachmentDiagnostic = {
  readonly kind: "image"
  readonly mimeType: AgentImageAttachment["mimeType"]
  readonly name?: string
  readonly size: number
  readonly sha256: string
  readonly preparedForSdk: true
} | {
  readonly kind: "path"
  readonly path: string
  readonly entryType: AgentPathAttachment["entryType"]
  readonly name?: string
  readonly preparedForSdk: false
  readonly includedInReadableContent: true
}

interface ParsedAbsolutePath {
  readonly flavor: PathFlavor
  readonly value: string
}

export function normalizeAgentAttachments(
  attachments: readonly AgentAttachment[] | undefined,
): readonly AgentAttachment[] {
  return attachments ? [...attachments] : []
}

export function buildClaudeUserMessageContent(
  readableContent: string,
  attachments: readonly AgentAttachment[],
): SdkMessageContent {
  const imageAttachments = attachments.filter(isImageAttachment)
  if (imageAttachments.length === 0) return readableContent

  const blocks: SdkContentBlocks = []
  for (const attachment of imageAttachments) {
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: attachment.mimeType,
        data: imageDataToBase64(attachment.data),
      },
    })
  }
  if (readableContent.length > 0) {
    blocks.push({ type: "text", text: readableContent })
  }
  return blocks
}

export function withReadablePathAttachmentContent(message: AgentMessage): AgentMessage {
  if (message.content.trim().length > 0) return message
  const readableContent = readablePathAttachmentContent(message.attachments)
  return readableContent ? { ...message, content: readableContent } : message
}

export function attachmentDiagnostics(
  attachments: readonly AgentAttachment[] | undefined,
): readonly AgentAttachmentDiagnostic[] {
  return normalizeAgentAttachments(attachments).map((attachment) => {
    if (isImageAttachment(attachment)) {
      const bytes = imageDataToBuffer(attachment.data)
      return {
        kind: "image",
        mimeType: attachment.mimeType,
        ...(attachment.name ? { name: attachment.name } : {}),
        size: attachment.size ?? bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        preparedForSdk: true,
      }
    }
    return {
      kind: "path",
      path: attachment.path,
      entryType: attachment.entryType,
      ...(attachment.name ? { name: attachment.name } : {}),
      preparedForSdk: false,
      includedInReadableContent: true,
    }
  })
}

export function attachmentHistoryMetadata(
  attachments: readonly AgentAttachment[] | undefined,
): Record<string, unknown> | undefined {
  const diagnostics = attachmentDiagnostics(attachments)
  return diagnostics.length > 0 ? { attachments: diagnostics } : undefined
}

export function userMessagePresentationHistoryMetadata(
  message: AgentMessage,
  persistedImages: readonly AgentUserMessageImageArtifact[],
): Record<string, unknown> {
  const attachments: Record<string, unknown>[] = []
  let imageIndex = 0
  for (const attachment of normalizeAgentAttachments(message.attachments)) {
    if (isImageAttachment(attachment)) {
      const persisted = persistedImages[imageIndex]
      if (!persisted) throw new Error("Persisted user image metadata is incomplete")
      attachments.push({
        kind: "image",
        id: persisted.id,
        ...(persisted.name ? { name: persisted.name } : {}),
        mimeType: persisted.mimeType,
        byteSize: persisted.byteSize,
        url: persisted.url,
        ...(persisted.sha256 ? { sha256: persisted.sha256 } : {}),
      })
      imageIndex += 1
      continue
    }
    attachments.push({
      kind: "path",
      path: attachment.path,
      entryType: attachment.entryType,
      name: attachment.name ?? path.basename(attachment.path),
      ...(attachment.size !== undefined ? { byteSize: attachment.size } : {}),
    })
  }
  return {
    userMessagePresentation: {
      version: 1,
      content: message.displayContent ?? message.content,
    },
    ...(attachments.length > 0 ? { attachments } : {}),
  }
}

export function readablePathAttachmentContent(
  attachments: readonly AgentAttachment[] | undefined,
): string {
  const pathAttachments = normalizeAgentAttachments(attachments).filter(isPathAttachment)
  if (pathAttachments.length === 0) return ""

  const filePaths = pathAttachments
    .filter((attachment) => attachment.entryType === "file")
    .map((attachment) => attachment.path)
  const directoryPaths = pathAttachments
    .filter((attachment) => attachment.entryType === "directory")
    .map((attachment) => attachment.path)
  const sections: string[] = []
  if (filePaths.length > 0) {
    sections.push(["粘贴文件:", ...filePaths].join("\n"))
  }
  if (directoryPaths.length > 0) {
    sections.push(["粘贴文件夹:", ...directoryPaths].join("\n"))
  }
  return sections.join("\n\n")
}

export function directoriesForPathAttachments(input: {
  readonly cwd: string
  readonly attachments: readonly AgentAttachment[]
}): readonly string[] {
  const cwd = parseAbsolutePath(input.cwd)
  const directories: ParsedAbsolutePath[] = []
  for (const attachment of input.attachments) {
    if (!isPathAttachment(attachment)) continue
    const targetPath = parseAbsolutePath(attachment.path)
    if (!targetPath) continue
    if (cwd && targetPath.flavor === cwd.flavor && isInsideOrEqual(targetPath, cwd)) continue
    const directory = attachment.entryType === "directory"
      ? targetPath
      : dirname(targetPath)
    addDirectory(directories, directory)
  }
  return directories.map((directory) => directory.value)
}

export function hasUnconfiguredAttachmentDirectories(input: {
  readonly cwd: string
  readonly attachments: readonly AgentAttachment[]
  readonly configuredDirectories: readonly string[]
}): boolean {
  const requiredDirectories = directoriesForPathAttachments({
    cwd: input.cwd,
    attachments: input.attachments,
  })
  const configuredDirectories = input.configuredDirectories
    .map(parseAbsolutePath)
    .filter((directory): directory is ParsedAbsolutePath => Boolean(directory))
  return requiredDirectories
    .map(parseAbsolutePath)
    .filter((directory): directory is ParsedAbsolutePath => Boolean(directory))
    .some((directory) =>
      !configuredDirectories.some((configured) =>
        directory.flavor === configured.flavor && isInsideOrEqual(directory, configured)))
}

export function mergeAdditionalDirectories(
  ...directoryGroups: readonly (readonly string[])[]
): readonly string[] {
  const directories: ParsedAbsolutePath[] = []
  for (const value of directoryGroups.flat()) {
    const directory = parseAbsolutePath(value)
    if (directory) addDirectory(directories, directory)
  }
  return directories.map((directory) => directory.value)
}

function isImageAttachment(attachment: AgentAttachment): attachment is AgentImageAttachment {
  return attachment.kind === "image"
}

function isPathAttachment(attachment: AgentAttachment): attachment is AgentPathAttachment {
  return attachment.kind === "path"
}

function imageDataToBase64(data: ArrayBuffer | Uint8Array): string {
  return imageDataToBuffer(data).toString("base64")
}

function imageDataToBuffer(data: ArrayBuffer | Uint8Array): Buffer {
  if (data instanceof Uint8Array) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  }
  return Buffer.from(data)
}

function addDirectory(directories: ParsedAbsolutePath[], directory: ParsedAbsolutePath): void {
  if (directories.some((existing) =>
    existing.flavor === directory.flavor && isInsideOrEqual(directory, existing))) {
    return
  }
  for (let index = directories.length - 1; index >= 0; index -= 1) {
    const existing = directories[index]
    if (existing && existing.flavor === directory.flavor && isInsideOrEqual(existing, directory)) {
      directories.splice(index, 1)
    }
  }
  directories.push(directory)
}

function dirname(targetPath: ParsedAbsolutePath): ParsedAbsolutePath {
  const ops = pathOps(targetPath.flavor)
  return {
    flavor: targetPath.flavor,
    value: ops.dirname(targetPath.value),
  }
}

function isInsideOrEqual(targetPath: ParsedAbsolutePath, rootPath: ParsedAbsolutePath): boolean {
  if (targetPath.flavor !== rootPath.flavor) return false
  const ops = pathOps(targetPath.flavor)
  const relative = ops.relative(rootPath.value, targetPath.value)
  return comparePath(targetPath.value, rootPath.value, targetPath.flavor) === 0
    || (!relative.startsWith("..") && !ops.isAbsolute(relative))
}

function parseAbsolutePath(value: string): ParsedAbsolutePath | undefined {
  const flavor = pathFlavor(value)
  if (!flavor) return undefined
  const ops = pathOps(flavor)
  return {
    flavor,
    value: ops.normalize(value),
  }
}

function pathFlavor(value: string): PathFlavor | undefined {
  if (isWindowsDriveAbsolute(value) || isWindowsUncAbsolute(value)) return "win32"
  if (value.startsWith("/")) return "posix"
  return undefined
}

function isWindowsDriveAbsolute(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value)
}

function isWindowsUncAbsolute(value: string): boolean {
  return /^([\\/])\1[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(value)
}

function pathOps(flavor: PathFlavor): typeof path.posix | typeof path.win32 {
  return flavor === "win32" ? path.win32 : path.posix
}

function comparePath(left: string, right: string, flavor: PathFlavor): number {
  const normalizedLeft = flavor === "win32" ? left.toLowerCase() : left
  const normalizedRight = flavor === "win32" ? right.toLowerCase() : right
  return normalizedLeft === normalizedRight ? 0 : -1
}
