import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, it } from "vitest"
import { captureImagePresentation } from "../image-presentation"
import { persistContextContinuation } from "../context-continuation"
import { imageRuntimeHarness } from "./fixtures/image-runtime-harness"
import { createNativeSdkFixture, toolResult } from "./fixtures/native-sdk-fixture"

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF3sAAAAASUVORK5CYII=", "base64")
it.each(["continue", "changed", "missing-checkpoint"] as const)("a restarted Runtime retains pending evidence and only executes on explicit continue: %s", async (action) => {
  const fixture = await createNativeSdkFixture((_request, i) => i === 0
    ? [{ name: "Read", id: "restored-read", input: { file_path: path.join(fixture.root, "original.png") } }] : "restored")
  const setup = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model" })
  await writeFile(path.join(fixture.root, "original.png"), png)
  await writeFile(path.join(fixture.root, "counter.txt"), "executed\n")
  const original = await captureImagePresentation(path.join(fixture.root, "original.png"), fixture.root, "old-read")
  const conversation = await setup.repository.getOrCreateActive(setup.message("Read original.png; counter already executed."))
  await persistContextContinuation({ store: setup.store, projectId: "image-acceptance", conversation, turnId: "old-turn",
    runtimeMessage: "Read original.png; never repeat the completed counter.", rotation: {
      reason: "image-presentation", completedBatches: 1, summary: "", lastToolBatch: [], pendingImages: [original],
    }, onCheckpoint: async (checkpointPath, checkpointArtifacts) => {
      await setup.repository.saveContextHandoff(conversation.id, { version: 1, turnId: "old-turn", generation: 1,
        phase: "prepared", checkpointPath, checkpointArtifacts, pendingImages: [original] }, 0)
    },
  })
  if (action === "changed") await writeFile(original.path, "different original")
  if (action === "missing-checkpoint") {
    const saved = await setup.conversations.get(conversation.id)
    await writeFile(saved!.contextHandoff!.checkpointPath, "corrupt checkpoint")
  }
  const restored = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model" })
  try {
    expect((await restored.conversations.get(conversation.id))?.contextHandoff?.phase).toBe("prepared")
    expect(restored.sessions).toHaveLength(0)
    expect(fixture.requests).toHaveLength(0)
    const result = await restored.router.send(restored.message("继续"))
    if (action === "continue") {
      expect(result.error).toBeUndefined()
      expect(result.resultText).toBe("restored")
      expect(toolResult(fixture.requests[1], "restored-read")).toMatchObject({ content: expect.arrayContaining([expect.objectContaining({ type: "image" })]) })
      expect((await restored.conversations.get(conversation.id))?.contextHandoff).toMatchObject({ generation: 2,
        pendingImages: [{ toolUseId: "old-read", attempts: 1, presented: true }] })
    } else {
      expect(result.error).toBeDefined()
      expect(restored.sessions).toHaveLength(0)
      expect((await restored.conversations.get(conversation.id))?.contextHandoff?.pendingImages[0]?.attempts).toBe(0)
    }
    expect(await readFile(path.join(fixture.root, "counter.txt"), "utf8")).toBe("executed\n")
  } finally { await restored.close(); await setup.close(); await fixture.close() }
}, 20_000)
