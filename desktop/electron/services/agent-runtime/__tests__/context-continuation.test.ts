import { describe, expect, it, vi } from "vitest"
import { persistContextContinuation, withContextContinuationUsage } from "../context-continuation"
import type { ConversationEntryV1 } from "../../../runtime/data-repo"

describe("context continuation checkpoints", () => {
  it("preserves execution paths, early requirements and the latest unprocessed batch inline", async () => {
    const persistToolOutputText = vi.fn(async () => ({ id: "a", storagePath: "/private/checkpoint.txt",
      originalByteSize: 100, storedByteSize: 100, contentTruncated: false }))
    const prompt = await persistContextContinuation({
      store: { persistToolOutputText }, projectId: "p1", turnId: "t1", runtimeMessage: "继续",
      workspacePath: "/tmp/中文 工作目录",
      conversation: { id: "c1", history: [
        { role: "user", content: "全文阅读，禁止抽样；使用 /tmp/原始目录/progress.tsv" },
        { role: "assistant", content: "完成了第一块" },
        { role: "user", content: "继续" },
      ] } as ConversationEntryV1,
      rotation: { reason: "request-budget", completedBatches: 1,
        summary: "下一块在 /tmp/中文 工作目录/next.json；Authorization: Bearer canary-secret",
        lastToolBatch: [{ tool_use_id: "read-7", tool_response: "尚未处理的证据" }] },
    })
    expect(prompt).toContain("/tmp/中文 工作目录")
    expect(prompt).toContain("/tmp/原始目录/progress.tsv")
    expect(prompt).toContain("禁止抽样")
    expect(prompt).toContain("read-7")
    expect(prompt).toContain("尚未处理的证据")
    expect(prompt).not.toContain("canary-secret")
    expect(prompt).not.toContain("[absolute-path]")
  })
  it("preserves long Unicode records in short readable lines while bounding the injected handoff", async () => {
    const stored: string[] = []
    const persistToolOutputText = vi.fn(async ({ content }: { content: string }) => {
      stored.push(content)
      return { id: String(stored.length), storagePath: `/private/${stored.length}.txt`,
        originalByteSize: Buffer.byteLength(content), storedByteSize: Buffer.byteLength(content), contentTruncated: false }
    })
    const original = "完整要求😀".repeat(20_000)
    const conversation = {
      id: "c1", projectId: "p1", history: [{ role: "user", content: original }],
    } as ConversationEntryV1
    const prompt = await persistContextContinuation({
      store: { persistToolOutputText }, projectId: "p1", conversation, turnId: "t1",
      runtimeMessage: original,
      rotation: { reason: "ineffective-compaction", summary: "重要进度".repeat(20_000), completedBatches: 10,
        lastToolBatch: [{ tool_response: { authorization: "Bearer private-value", source: { type: "base64", data: "hidden-image-bytes" },
          content: [{ type: "image", mimeType: "image/png", data: "mcp-image-bytes" }] } }] },
    })
    expect(Buffer.byteLength(prompt)).toBeLessThanOrEqual(32 * 1024)
    expect(prompt).toContain("Full checkpoint index")
    const fragments = stored.slice(0, -1).flatMap((part) => part.trim().split("\n").map((line) => {
      expect(Buffer.byteLength(line)).toBeLessThan(8 * 1024)
      return JSON.parse(line) as { record: number; text: string }
    }))
    const restored = fragments.filter((fragment) => fragment.record === 2).map((fragment) => fragment.text).join("")
    expect(JSON.parse(restored).content).toBe(original)
    expect(stored.join("")).not.toContain("private-value")
    expect(stored.join("")).not.toContain("hidden-image-bytes")
    expect(stored.join("")).not.toContain("mcp-image-bytes")
  })

  it("writes incremental history and plain progress, retaining all ancestor verification references", async () => {
    const stored: string[] = []
    const persistToolOutputText = vi.fn(async ({ content }: { content: string }) => {
      stored.push(content)
      return { id: `new-${stored.length}`, storagePath: `/private/new-${stored.length}`, originalByteSize: Buffer.byteLength(content),
        storedByteSize: Buffer.byteLength(content), contentTruncated: false }
    })
    const onCheckpoint = vi.fn()
    const progress = async function* () { yield JSON.stringify({ kind: "assessment", revision: 7 }); yield JSON.stringify({ recordType: "unit", id: "kept", processed: true }) }
    const prompt = await persistContextContinuation({ store: { persistToolOutputText }, projectId: "p", turnId: "t", runtimeMessage: "continue",
      conversation: { id: "c", history: [{ role: "assistant", content: "old-private-evidence" }, { role: "assistant", content: "new-evidence" }],
        contextHandoff: { turnId: "t", historyWatermark: 1, checkpointPath: "/private/parent", checkpointArtifacts: ["ancestor-part", "ancestor-index"] } } as ConversationEntryV1,
      rotation: { reason: "request-budget", summary: "", completedBatches: 1, lastToolBatch: [] }, progress: progress(), onCheckpoint })
    expect(stored.join("\n")).not.toContain("old-private-evidence")
    expect(stored.join("\n")).toContain("new-evidence")
    expect(stored.join("\n")).toContain("/private/parent")
    expect(stored.some((page) => page.includes('{"recordType":"unit","id":"kept","processed":true}'))).toBe(true)
    expect(onCheckpoint).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(["ancestor-part", "ancestor-index"]),
      expect.objectContaining({ historyWatermark: 2, progressIndexPath: expect.any(String) }))
    expect(prompt).toContain('"revision":7')
    onCheckpoint.mockRejectedValueOnce(new Error("save failed"))
    await expect(persistContextContinuation({ store: { persistToolOutputText }, projectId: "p", turnId: "t", runtimeMessage: "continue",
      conversation: { id: "c", history: [] } as unknown as ConversationEntryV1,
      rotation: { reason: "request-budget", summary: "", completedBatches: 0, lastToolBatch: [] }, onCheckpoint })).rejects.toThrow("save failed")
  })

  it("includes retired session usage without claiming that the last SDK cost covers the whole turn", () => {
    const result = withContextContinuationUsage({ type: "result" as const, done: true as const, content: "done",
      usage: { input_tokens: 200, output_tokens: 20 }, costUsd: 0.1 }, [
      { usage: { input_tokens: 100, output_tokens: 10 } },
    ])
    expect(result.usage).toMatchObject({ inputTokens: 300, outputTokens: 30, totalTokens: 330 })
    expect(result.costUsd).toBeUndefined()
  })

  it("rejects a truncated checkpoint instead of claiming a complete handoff", async () => {
    await expect(persistContextContinuation({
      store: { persistToolOutputText: vi.fn(async () => ({ id: "a", storagePath: "/private/a", originalByteSize: 100,
        storedByteSize: 10, contentTruncated: true })) },
      projectId: "p1", conversation: { id: "c1", history: [] } as unknown as ConversationEntryV1,
      turnId: "t1", runtimeMessage: "task",
      rotation: { reason: "request-budget", summary: "", completedBatches: 1, lastToolBatch: [] },
    })).rejects.toThrow("未能完整保存")
  })
})
