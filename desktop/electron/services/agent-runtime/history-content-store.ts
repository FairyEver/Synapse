import { AGENT_HISTORY_CHUNK_BYTES } from "../../../config"
import { createHash, randomUUID } from "node:crypto"
import type { DataRepository, DataNamespace, AtomicBatchRequest } from "../../runtime/data-repo/types"
import {
  historyContentNamespace, historyChunkNamespace,
  type HistoryContentManifest, type HistoryContentChunk, type HistoryContentRef,
} from "../../runtime/data-repo/schemas/agent-history"
import type { AgentArtifactStore } from "./artifact-store"

export interface HistoryScope { readonly projectId: string; readonly conversationId: string }
export function scopedRecordId(scope: HistoryScope, key: string): string {
  return createHash("sha256").update(JSON.stringify([scope.projectId, scope.conversationId, key])).digest("hex")
}

export async function commitHistoryBatch(repo: DataRepository, request: AtomicBatchRequest): Promise<boolean> {
  if (!repo.commitBatch) throw new Error("Agent history requires atomic DataRepository support")
  return (await repo.commitBatch(request)).committed
}

export async function queryHistoryRange<T>(ns: DataNamespace<T>, query: Parameters<NonNullable<DataNamespace<T>["queryRange"]>>[0]): Promise<T[]> {
  if (!ns.queryRange) throw new Error("Agent history requires indexed DataRepository queries")
  return ns.queryRange(query)
}

/** Emits at most 32 KiB per chunk, preserving surrogate pairs across source chunks. */
export async function* historyTextChunks(source: AsyncIterable<string>): AsyncIterable<string> {
  let tail = ""
  let bytes = 0
  let highSurrogate = ""
  for await (const incoming of source) {
    const text = highSurrogate + incoming
    highSurrogate = ""
    for (let offset = 0; offset < text.length;) {
      const code = text.charCodeAt(offset)
      if (offset === text.length - 1 && code >= 0xd800 && code <= 0xdbff) { highSurrogate = text[offset]; break }
      const point = text.codePointAt(offset)!
      const char = String.fromCodePoint(point)
      const size = Buffer.byteLength(char)
      if (bytes + size > AGENT_HISTORY_CHUNK_BYTES) { yield tail; tail = ""; bytes = 0 }
      tail += char
      bytes += size
      offset += char.length
    }
  }
  if (highSurrogate) {
    // Invalid standalone UTF-16 is canonically represented by UTF-8 replacement, as Buffer does.
    if (bytes + 3 > AGENT_HISTORY_CHUNK_BYTES) { yield tail; tail = "" }
    tail += "\ufffd"
  }
  if (tail) yield tail
}

export class HistoryContentStore {
  constructor(private readonly repo: DataRepository, private readonly artifacts: AgentArtifactStore) {}

  async stage(scope: HistoryScope, turnId: string, source: AsyncIterable<string>): Promise<HistoryContentRef> {
    const contentId = randomUUID()
    const id = scopedRecordId(scope, contentId)
    let bytes = 0
    let utf16Length = 0
    let ordinal = 0
    const hash = createHash("sha256")
    const manifest: HistoryContentManifest = { ...scope, id, schemaVersion: 1, contentId, version: 1,
      state: "staging", sha256: hash.copy().digest("hex"), bytes: 0, utf16Length: 0, chunkCount: 0 }
    if (!await commitHistoryBatch(this.repo, { guards: [], operations: [
      { kind: "insert", namespace: historyContentNamespace.name, id, value: manifest },
    ] })) throw new Error("正文清单提交冲突。")
    try {
      for await (const text of historyTextChunks(source)) {
        const artifact = await this.artifacts.persistToolOutputText({ ...scope, turnId, content: text })
        if (!artifact || artifact.contentTruncated) throw new Error("正文块未能完整保存。")
        const chunk: HistoryContentChunk = { ...scope, schemaVersion: 1,
          id: scopedRecordId(scope, `${contentId}:${ordinal}`), contentId, version: 1, ordinal,
          byteStart: bytes, bytes: Buffer.byteLength(text), utf16Start: utf16Length, utf16Length: text.length,
          sha256: createHash("sha256").update(text).digest("hex"), artifactId: artifact.id,
        }
        hash.update(text)
        bytes += chunk.bytes; utf16Length += text.length; ordinal += 1
        if (!await commitHistoryBatch(this.repo, { guards: [], operations: [
          { kind: "insert", namespace: historyChunkNamespace.name, id: chunk.id, value: chunk },
          { kind: "patch", namespace: historyContentNamespace.name, id,
            patch: { sha256: hash.copy().digest("hex"), bytes, utf16Length, chunkCount: ordinal } },
        ] })) throw new Error("正文块提交冲突。")
      }
    } catch (error) {
      try { await this.markOrphan(scope, contentId) }
      catch (orphanError) { throw new AggregateError([error, orphanError], "正文保存及暂存状态更新失败。", { cause: orphanError }) }
      throw error
    }
    return { contentId, version: 1, sha256: hash.digest("hex"), bytes, utf16Length }
  }

  async markOrphan(scope: HistoryScope, contentId: string): Promise<void> {
    const id = scopedRecordId(scope, contentId)
    if (!await commitHistoryBatch(this.repo, { guards: [{ namespace: historyContentNamespace.name, id, expected: { state: "staging" } }],
      operations: [{ kind: "patch", namespace: historyContentNamespace.name, id, patch: { state: "orphan" } }] })) {
      throw new Error("无法更新正文暂存状态。")
    }
  }

  async read(scope: HistoryScope, ref: HistoryContentRef, offset: number): Promise<{ text: string; nextOffset: number | null }> {
    const manifest = await this.repo.namespace<HistoryContentManifest>(historyContentNamespace.name).get(scopedRecordId(scope, ref.contentId))
    if (!manifest || manifest.state !== "committed" || manifest.version !== ref.version || manifest.sha256 !== ref.sha256
      || !Number.isSafeInteger(offset) || offset < 0 || offset > manifest.utf16Length) throw new Error("正文引用或偏移无效。")
    if (offset === manifest.utf16Length) return { text: "", nextOffset: null }
    const chunks = this.repo.namespace<HistoryContentChunk>(historyChunkNamespace.name)
    const [chunk] = await queryHistoryRange(chunks, { index: "scope_content_offset",
      equal: { ...scope, contentId: ref.contentId, version: ref.version }, range: { field: "utf16Start", lte: offset }, direction: "desc", limit: 1 })
    if (!chunk || offset >= chunk.utf16Start + chunk.utf16Length) throw new Error("正文块缺失。")
    const text = await this.artifacts.readToolOutputBlock({ ...scope, artifactId: chunk.artifactId })
    if (text.length !== chunk.utf16Length || Buffer.byteLength(text) !== chunk.bytes
      || createHash("sha256").update(text).digest("hex") !== chunk.sha256) throw new Error("正文块校验失败。")
    const localOffset = offset - chunk.utf16Start
    if (localOffset > 0 && /[\uDC00-\uDFFF]/.test(text[localOffset]) && /[\uD800-\uDBFF]/.test(text[localOffset - 1])) {
      throw new Error("正文偏移不可拆分字符。")
    }
    const nextOffset = chunk.utf16Start + chunk.utf16Length
    return { text: text.slice(localOffset), nextOffset: nextOffset < manifest.utf16Length ? nextOffset : null }
  }
}
