import { writeFile, readFile } from "node:fs/promises"
import path from "node:path"
import { expect, it } from "vitest"
import { imageRuntimeHarness } from "./fixtures/image-runtime-harness"
import { createNativeSdkFixture, toolResult } from "./fixtures/native-sdk-fixture"

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF3sAAAAASUVORK5CYII=", "base64")
it.each(["present", "skip", "permission", "still-full"] as const)("Runtime checkpoints parallel results and requires native image presentation before success: %s", async (mode) => {
  let phase = 0
  const fixture = await createNativeSdkFixture(() => {
    if (phase++ === 0) return [
      { name: "Read", id: "original-read", input: { file_path: path.join(fixture.root, "original.png") } },
      { name: "Bash", id: "count-once", input: { command: "sleep 0.2; echo executed >> action-count.txt" } },
    ]
    if (phase === 2 && mode !== "skip") return [{ name: "Read", id: "resumed-read", input: { file_path: path.join(fixture.root, "original.png") } }]
    return "verified"
  })
  await writeFile(path.join(fixture.root, "original.png"), png)
  const harness = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model", firstImagePressure: true, denyResumedReads: mode === "permission", pressureGenerations: mode === "still-full" ? 2 : 1 })
  const running = harness.router.send(harness.message("Execute the counter once, then Read original.png and verify it."))
  try {
    const result = await running
    if (mode !== "present") {
      expect(result.error).toContain(mode === "still-full" ? "图片在干净会话中仍无法容纳" : "待呈现图片")
      const saved = await harness.conversations.get(result.conversationId)
      expect(saved?.contextHandoff?.pendingImages[0]?.presented).not.toBe(true)
      expect(saved?.history.some((entry) => entry.metadata?.agentEventType === "error" && entry.content.includes(mode === "still-full" ? "body=" : "待呈现图片"))).toBe(true)
      expect(harness.sessions).toHaveLength(2)
      expect(fixture.requests).toHaveLength(mode === "permission" ? 3 : 2)
      expect(await readFile(path.join(fixture.root, "action-count.txt"), "utf8")).toBe("executed\n")
      return
    }
    expect(result.error).toBeUndefined()
    expect(result.resultText).toBe("verified")
    expect(harness.sessions).toHaveLength(2)
    expect(fixture.requests).toHaveLength(3)
    expect(toolResult(fixture.requests[1], "original-read")).toBeUndefined()
    const delivered = toolResult(fixture.requests[2], "resumed-read") as { content: Array<{ type: string; source?: { data?: string } }> }
    expect(delivered.content.find((block) => block.type === "image")?.source?.data).toBe(png.toString("base64"))
    expect(await readFile(path.join(fixture.root, "action-count.txt"), "utf8")).toBe("executed\n")
    const saved = await harness.conversations.get(result.conversationId)
    expect(saved?.contextHandoff).toMatchObject({ generation: 1, phase: "submitted", pendingImages: [
      { toolUseId: "original-read", attempts: 1, presented: true },
    ] })
    expect(saved?.history.filter((entry) => entry.role === "user")).toHaveLength(1)
  } finally { await harness.close(); await fixture.close() }
}, 30_000)
