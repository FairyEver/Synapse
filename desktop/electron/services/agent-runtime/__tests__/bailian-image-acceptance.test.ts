import { createHash } from "node:crypto"
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, it } from "vitest"
import { imageRuntimeHarness } from "./fixtures/image-runtime-harness"
import { markedImage } from "./fixtures/marked-image"

// Opt-in only: credentials are injected by the operator in process environment.
// Never reads the user's conversation or modifies their active task.
it.skipIf(process.env.SYNAPSE_BAILIAN_IMAGE_ACCEPTANCE !== "1" || process.env.SYNAPSE_BAILIAN_CANCEL_ACCEPTANCE === "1")("48 real marked images continue across native Runtime handoffs", async () => {
  const root = process.env.SYNAPSE_IMAGE_ACCEPTANCE_ROOT
  const token = process.env.SYNAPSE_IMAGE_ACCEPTANCE_TOKEN
  if (!root || !token) throw new Error("Acceptance root and configured credential are required")
  await mkdir(root, { recursive: true })
  // Independent oracle stays outside the directory presented as task input.
  const evidenceRoot = `${root}-evidence`
  await mkdir(evidenceRoot, { recursive: true })
  const manifest = []
  const taskProgressAcceptance = process.env.SYNAPSE_TASK_PROGRESS_ACCEPTANCE === "1"
  for (let i = 1; i <= 48; i++) {
    const name = `image-${String(i).padStart(2, "0")}.png`
    const marker = String(1000 + ((i * 7919) % 9000))
    const dimensions = process.env.SYNAPSE_IMAGE_LARGE === "1" && i <= 4 ? [970, 1866] as const : [720, 480] as const
    const data = markedImage(marker, i * 173 + 7, ...dimensions)
    await writeFile(path.join(root, name), data)
    manifest.push({ name, marker, width: dimensions[0], height: dimensions[1], bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") })
  }
  const records = JSON.stringify(manifest.map((row, index) => ({ id: index + 1, file: row.name })), null, 2)
  const textManifest = taskProgressAcceptance ? { name: "records.json", rows: 48, bytes: Buffer.byteLength(records), sha256: createHash("sha256").update(records).digest("hex") } : undefined
  if (taskProgressAcceptance) await writeFile(path.join(root, "records.json"), records)
  const sourceFiles = ["context-budget.ts", "claude-sdk-session.ts", "query-stop-barrier.ts", "image-presentation.ts", "context-continuation.ts", "conversation-router.ts", "session-repository.ts", "session-manager.ts", "artifact-store.ts", "types.ts", "task-progress.ts", "task-progress-hooks.ts", "assistant-output-integrity.ts", "../../runtime/data-repo/schemas/agent-task-progress.ts", "../../modules/agent/ipc-shared.ts", "../../../src/lib/agent-timeline.ts", "../../../src/types/agent.ts"]
  const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file,
    createHash("sha256").update(await readFile(new URL(`../${file}`, import.meta.url))).digest("hex") ])))
  const sdkVersion = JSON.parse(await readFile(path.resolve("node_modules/@anthropic-ai/claude-agent-sdk/package.json"), "utf8")).version
  const controlledPressure = process.env.SYNAPSE_IMAGE_PRESSURE === "1"
  const harness = imageRuntimeHarness({ root, model: "qwen3.8-max", firstImagePressure: controlledPressure, env: {
    ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com/apps/anthropic", ANTHROPIC_AUTH_TOKEN: token,
    ANTHROPIC_MODEL: "qwen3.8-max", CLAUDE_CODE_MAX_OUTPUT_TOKENS: "4096",
  } })
  const started = new Date().toISOString()
  await writeFile(path.join(evidenceRoot, "acceptance-start.json"), JSON.stringify({ started, controlledPressure, taskProgressAcceptance, sourceHashes,
    sdk: sdkVersion, model: "qwen3.8-max", autoCompactWindow: 200000, bodySafety: 5 * 1024 * 1024, bodyHard: 6 * 1024 * 1024, manifest, textManifest }, null, 2))
  const controller = new AbortController()
  let deadlineReached = false
  const deadline = setTimeout(() => { deadlineReached = true; controller.abort() }, 55 * 60 * 1000)
  let result: Awaited<ReturnType<typeof harness.router.send>> | undefined
  let passed = false
  try {
    result = await harness.router.send(harness.message(taskProgressAcceptance ? [
      `请完整核对 ${root} 中的 records.json 和全部 48 张图片，逐张识别图上的四位数字，不能遗漏或猜测。不要用 OCR、程序推算数字、转换图片、网络或子代理；不要改动原始材料。`,
      "把每张图片的结果按文件编号顺序写入 answers.txt，每行格式为 image-NN.png 四位数字；无法完成的项目请明确说明。所有写入限于当前目录。",
      "开始读取材料前，先执行一次 printf 'executed\\n' >> action-count.txt；后面的整个任务都不要重复这个动作。",
    ].join("\n") : [
      "Complete this controlled image acceptance task. Work only in this directory.",
      "First execute exactly once: printf 'executed\\n' >> action-count.txt . Never repeat this action after maintenance.",
      "There are exactly 48 files image-01.png through image-48.png. Each shows a large four-digit marker above noise.",
      "Read every image sequentially using native Read, visually identify its marker, then append one line with Bash: image-NN.png MARKER to answers.txt. Do not use OCR, programs to derive digits, image conversion, or subagents. Do not guess. Do not Read images in parallel.",
      "After context maintenance, inspect answers.txt to identify completed items. First re-present any pending original specified by the handoff, then append its answer only if it is absent. Never repeat completed actions or duplicate answer rows. Continue through image-48.png in the same task.",
      "Finish only after all 48 answers are recorded. The harness will independently compare every marker and check action count, original versions and actual handoffs.",
    ].join("\n")), { abortSignal: controller.signal })
    expect(result.error).toBeUndefined()
    const lines = (await readFile(path.join(root, "answers.txt"), "utf8")).trim().split(/\r?\n/)
    expect(lines).toEqual(manifest.map((row) => `${row.name} ${row.marker}`))
    expect(await readFile(path.join(root, "action-count.txt"), "utf8")).toBe("executed\n")
    expect(harness.sessions.length).toBeGreaterThan(2)
    const saved = await harness.conversations.get(result.conversationId)
    expect(saved?.contextHandoff?.pendingImages.length).toBeGreaterThan(0)
    expect(saved?.contextHandoff?.pendingImages.every((image) => image.presented)).toBe(true)
    if (taskProgressAcceptance) {
      const assessment = await harness.repository.taskProgress!.assessment(result.conversationId, saved!.contextHandoff!.turnId)
      expect(assessment).toMatchObject({ status: "coverage-complete", semanticCorrectness: "unverified" })
      expect(assessment.processedUnits).toBeGreaterThanOrEqual(49)
      const state = await harness.repository.taskProgress!.state(result.conversationId, saved!.taskProgressScope!.turnId)
      const coveredOriginals = new Set([...state.units.values()].filter((unit) => unit.processed).map((unit) => unit.canonicalPath ?? unit.path))
      for (const name of ["records.json", ...manifest.map((row) => row.name)]) {
        expect(coveredOriginals.has(await realpath(path.join(root, name)))).toBe(true)
      }
      expect(await readFile(path.join(root, "records.json"), "utf8")).toBe(records)
      const counterCalls = saved!.history.filter((entry) => entry.metadata?.agentEventType === "toolUse" && entry.metadata.toolName === "Bash"
        && entry.content.includes("action-count.txt") && entry.content.includes("executed"))
      expect(counterCalls).toHaveLength(1)
      expect(counterCalls[0]!.metadata?.sdkSessionId).toBe(harness.sessions[0]!.currentSessionId())
    }
    for (const row of manifest) expect(createHash("sha256").update(await readFile(path.join(root, row.name))).digest("hex")).toBe(row.sha256)
    passed = true
  } finally {
    clearTimeout(deadline)
    await writeFile(path.join(evidenceRoot, "acceptance-evidence.json"), JSON.stringify({
      deadlineReached, started, ended: new Date().toISOString(), passed, controlledPressure, taskProgressAcceptance, sourceHashes, sdk: sdkVersion, model: "qwen3.8-max", autoCompactWindow: 200000,
      bodySafety: 5 * 1024 * 1024, bodyHard: 6 * 1024 * 1024, manifest, textManifest,
      sessions: harness.sessions.length, conversationId: result?.conversationId, error: result?.error,
      result: result?.resultText, logs: harness.logs,
    }, null, 2))
    await harness.close()
  }
}, 3_600_000)

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


it.skipIf(process.env.SYNAPSE_BAILIAN_CANCEL_ACCEPTANCE !== "1")("real Runtime cancellation keeps SDK interrupt acknowledgement available", async () => {
  const root = process.env.SYNAPSE_IMAGE_ACCEPTANCE_ROOT
  const token = process.env.SYNAPSE_IMAGE_ACCEPTANCE_TOKEN
  if (!root || !token) throw new Error("Acceptance root and configured credential are required")
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, "image.png"), markedImage("1234", 7))
  const controller = new AbortController()
  let readObserved = false, passed = false
  const harness = imageRuntimeHarness({ root, model: "qwen3.8-max", env: {
    ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com/apps/anthropic", ANTHROPIC_AUTH_TOKEN: token,
    ANTHROPIC_MODEL: "qwen3.8-max", CLAUDE_CODE_MAX_OUTPUT_TOKENS: "4096",
  }, afterReadHook: async () => { readObserved = true; controller.abort(); return {} } })
  try {
    const result = await harness.router.send(harness.message(`Work only in ${root}. First execute exactly once: printf 'once\\n' >> counter.txt . Wait for that operation to finish, then use native Read on ${path.join(root, "image.png")} and report its marker. Do not use other files or tools to infer the answer.`), { abortSignal: controller.signal })
    expect(readObserved).toBe(true)
    expect(result.error).toContain("已停止")
    await expect(harness.sessions[0]!.close()).resolves.toBeUndefined()
    expect(harness.sessions).toHaveLength(1)
    expect(await readFile(path.join(root, "counter.txt"), "utf8")).toBe("once\n")
    expect(harness.logs.some((row) => row.message.includes("close failed") || row.message.includes("unconfirmed"))).toBe(false)
    passed = true
  } finally {
    await mkdir(`${root}-evidence`, { recursive: true })
    await writeFile(path.join(`${root}-evidence`, "cancellation.json"), JSON.stringify({ passed, readObserved,
      sdk: JSON.parse(await readFile(path.resolve("node_modules/@anthropic-ai/claude-agent-sdk/package.json"), "utf8")).version,
      model: "qwen3.8-max", sdkSessionSource: createHash("sha256").update(await readFile(new URL("../claude-sdk-session.ts", import.meta.url))).digest("hex"),
      interruptConfirmed: passed, sessions: harness.sessions.length, completedAt: new Date().toISOString() }, null, 2))
    await harness.close()
  }
}, 180_000)
