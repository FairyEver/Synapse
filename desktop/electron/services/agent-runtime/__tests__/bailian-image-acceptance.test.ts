import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, it } from "vitest"
import { imageRuntimeHarness } from "./fixtures/image-runtime-harness"
import { markedImage } from "./fixtures/marked-image"

// Opt-in only: credentials are injected by the operator in process environment.
// Never reads the user's conversation or modifies their active task.
it.skipIf(process.env.SYNAPSE_BAILIAN_IMAGE_ACCEPTANCE !== "1")("48 real marked images continue across native Runtime handoffs", async () => {
  const root = process.env.SYNAPSE_IMAGE_ACCEPTANCE_ROOT
  const token = process.env.SYNAPSE_IMAGE_ACCEPTANCE_TOKEN
  if (!root || !token) throw new Error("Acceptance root and configured credential are required")
  await mkdir(root, { recursive: true })
  const manifest = []
  for (let i = 1; i <= 48; i++) {
    const name = `image-${String(i).padStart(2, "0")}.png`
    const marker = String(1000 + ((i * 7919) % 9000))
    const dimensions = process.env.SYNAPSE_IMAGE_LARGE === "1" && i <= 4 ? [970, 1866] as const : [720, 480] as const
    const data = markedImage(marker, i * 173 + 7, ...dimensions)
    await writeFile(path.join(root, name), data)
    manifest.push({ name, marker, width: dimensions[0], height: dimensions[1], bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") })
  }
  const sourceFiles = ["context-budget.ts", "claude-sdk-session.ts", "query-stop-barrier.ts", "image-presentation.ts", "context-continuation.ts", "conversation-router.ts", "session-repository.ts", "artifact-store.ts", "types.ts"]
  const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file,
    createHash("sha256").update(await readFile(new URL(`../${file}`, import.meta.url))).digest("hex") ])))
  const sdkVersion = JSON.parse(await readFile(path.resolve("node_modules/@anthropic-ai/claude-agent-sdk/package.json"), "utf8")).version
  const controlledPressure = process.env.SYNAPSE_IMAGE_PRESSURE === "1"
  const harness = imageRuntimeHarness({ root, model: "qwen3.8-max", firstImagePressure: controlledPressure, env: {
    ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com/apps/anthropic", ANTHROPIC_AUTH_TOKEN: token,
    ANTHROPIC_MODEL: "qwen3.8-max", CLAUDE_CODE_MAX_OUTPUT_TOKENS: "4096",
  } })
  const started = new Date().toISOString()
  let result: Awaited<ReturnType<typeof harness.router.send>> | undefined
  let passed = false
  try {
    result = await harness.router.send(harness.message([
      "Complete this controlled image acceptance task. Work only in this directory.",
      "First execute exactly once: printf 'executed\\n' >> action-count.txt . Never repeat this action after maintenance.",
      "There are exactly 48 files image-01.png through image-48.png. Each shows a large four-digit marker above noise.",
      "Read every image sequentially using native Read, visually identify its marker, then append one line with Bash: image-NN.png MARKER to answers.txt. Do not use OCR, programs to derive digits, image conversion, or subagents. Do not guess. Do not Read images in parallel.",
      "After context maintenance, inspect answers.txt to identify completed items. First re-present any pending original specified by the handoff, then append its answer only if it is absent. Never repeat completed actions or duplicate answer rows. Continue through image-48.png in the same task.",
      "Finish only after all 48 answers are recorded. The harness will independently compare every marker and check action count, original versions and actual handoffs.",
    ].join("\n")))
    const lines = (await readFile(path.join(root, "answers.txt"), "utf8")).trim().split(/\r?\n/)
    expect(result.error).toBeUndefined()
    expect(lines).toEqual(manifest.map((row) => `${row.name} ${row.marker}`))
    expect(await readFile(path.join(root, "action-count.txt"), "utf8")).toBe("executed\n")
    expect(harness.sessions.length).toBeGreaterThan(2)
    const saved = await harness.conversations.get(result.conversationId)
    expect(saved?.contextHandoff?.pendingImages.length).toBeGreaterThan(0)
    expect(saved?.contextHandoff?.pendingImages.every((image) => image.presented)).toBe(true)
    for (const row of manifest) expect(createHash("sha256").update(await readFile(path.join(root, row.name))).digest("hex")).toBe(row.sha256)
    passed = true
  } finally {
    await writeFile(path.join(root, "acceptance-evidence.json"), JSON.stringify({
      started, ended: new Date().toISOString(), passed, controlledPressure, sourceHashes, sdk: sdkVersion, model: "qwen3.8-max", autoCompactWindow: 200000,
      bodySafety: 5 * 1024 * 1024, bodyHard: 6 * 1024 * 1024, manifest,
      sessions: harness.sessions.length, conversationId: result?.conversationId, error: result?.error,
      result: result?.resultText, logs: harness.logs,
    }, null, 2))
    await harness.close()
  }
}, 1_200_000)

it.skipIf(process.env.SYNAPSE_BAILIAN_IMAGE_FAILURE_ACCEPTANCE !== "1")("real Runtime reports a single image that still cannot fit after its one clean attempt", async () => {
  const root = process.env.SYNAPSE_IMAGE_ACCEPTANCE_ROOT
  const token = process.env.SYNAPSE_IMAGE_ACCEPTANCE_TOKEN
  if (!root || !token) throw new Error("Acceptance root and configured credential are required")
  await mkdir(root, { recursive: true })
  const original = markedImage("1234", 180, 970, 1866)
  await writeFile(path.join(root, "original.png"), original)
  const harness = imageRuntimeHarness({ root, model: "qwen3.8-max", firstImagePressure: true, pressureGenerations: 2,
    env: { ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com/apps/anthropic", ANTHROPIC_AUTH_TOKEN: token,
      ANTHROPIC_MODEL: "qwen3.8-max", CLAUDE_CODE_MAX_OUTPUT_TOKENS: "4096" } })
  const started = new Date().toISOString()
  const sdkSessionSource = createHash("sha256").update(await readFile(new URL("../claude-sdk-session.ts", import.meta.url))).digest("hex")
  try {
    const result = await harness.router.send(harness.message("Execute exactly once: printf 'executed\\n' >> action-count.txt . Then use native Read on original.png and report the visible four-digit marker. If context maintenance occurs, never repeat the completed counter action. Work only in this directory."))
    expect(result.error).toContain("图片在干净会话中仍无法容纳")
    expect(result.error).toContain("body=")
    expect(harness.sessions).toHaveLength(2)
    expect(await readFile(path.join(root, "action-count.txt"), "utf8")).toBe("executed\n")
    const saved = await harness.conversations.get(result.conversationId)
    expect(saved?.contextHandoff?.pendingImages).toHaveLength(1)
    expect(saved?.contextHandoff?.pendingImages[0]).toMatchObject({ attempts: 1 })
    expect(saved?.history.some((entry) => entry.metadata?.agentEventType === "error" && entry.content.includes("body="))).toBe(true)
    expect(await readFile(path.join(root, "original.png"))).toEqual(original)
    await writeFile(path.join(root, "acceptance-evidence.json"), JSON.stringify({ passed: true, started,
      ended: new Date().toISOString(), sdkSessionSource, scenario: "single-image-still-full", sessions: harness.sessions.length,
      error: result.error, originalBytes: original.length, width: 970, height: 1866, counter: 1,
      outcome: result.events.find((event) => event.type === "error")?.turnOutcome,
    }, null, 2))
  } finally { await harness.close() }
}, 240_000)
