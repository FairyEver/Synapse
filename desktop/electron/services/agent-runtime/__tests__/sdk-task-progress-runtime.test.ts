import { readFile, writeFile } from "node:fs/promises"
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"
import { expect, it } from "vitest"
import { imageRuntimeHarness } from "./fixtures/image-runtime-harness"
import { collectNativeResult, createNativeSdkFixture, toolResult, type FixtureCall } from "./fixtures/native-sdk-fixture"
import { markedImage } from "./fixtures/marked-image"
import type { ConversationEntryV1 } from "../../../runtime/data-repo"

// Scripted protocol evidence, not a claim of real visual understanding.
it.each([17, 11])("48 originals keep scope, findings and side effects across repeated native handoffs (pressure %s)", async (pressureAfterImages) => {
  let stage = 0, current = 1, revision = 0, attempt = 0, lastRead = ""
  const images: Buffer[] = []
  const unit = (n: number) => ({ id: `image-${n}`, kind: "image", path: path.join(fixture.root, `image-${n}.png`), receipts: [], processed: false })
  const commit = (data: Record<string, unknown>): FixtureCall[] => [{ name: stage === 1 ? "TaskCreate" : "TaskUpdate", id: `commit-${revision}`, input: {
    ...(stage === 1 ? { subject: "Verify inventory", description: "Every original and marker" } : { taskId: "1" }),
    metadata: { synapseProgress: { version: 1, baseRevision: revision++, ...data } },
  } }]
  const fixture = await createNativeSdkFixture((request) => {
    if (stage++ === 0) return commit({ units: Array.from({ length: 32 }, (_, i) => unit(i + 1)) })
    if (stage === 2) return commit({ units: Array.from({ length: 16 }, (_, i) => unit(i + 33)), seal: true })
    if (stage === 3) return [{ name: "Bash", id: "side-effect-once", input: { command: "printf 'executed\\n' >> action-count.txt" } }]
    if (lastRead) {
      const result = toolResult(request, lastRead) as { content?: Array<{ type: string; source?: { data?: string } }> } | undefined
      if (result) {
        expect(result.content?.some((block) => block.type === "image" && block.source?.data === images[current - 1]!.toString("base64"))).toBe(true)
        const response = commit({ units: [{ ...unit(current), receipts: [lastRead], processed: true }],
          findings: [{ id: `marker-${current}`, value: 1000 + current, evidence: [lastRead] }] })
        lastRead = ""
        current += 1
        return response
      }
    }
    if (current > 48) return "All declared images and markers have evidence. Semantic verification belongs to the independent evaluator."
    lastRead = `read-${current}-${++attempt}`
    return [{ name: "Read", id: lastRead, input: { file_path: unit(current).path } }]
  })
  for (let n = 1; n <= 48; n += 1) {
    const bytes = markedImage(String(1000 + n), n + 29, 720, 480)
    images.push(bytes)
    await writeFile(unit(n).path, bytes)
  }
  const harness = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model",
    firstImagePressure: true, pressureGenerations: 10, pressureAfterImages })
  try {
    const result = await harness.router.send(harness.message("Inspect every image in this directory and report all markers. Record the test action exactly once."))
    const diagnosticConversation = await harness.conversations.get(result.conversationId)
    const diagnosticState = diagnosticConversation?.contextHandoff?.turnId
      ? await harness.repository.taskProgress!.state(result.conversationId, diagnosticConversation.contextHandoff.turnId) : undefined
    expect(result.error, JSON.stringify({ current, revision, storedRevision: diagnosticState?.revision,
      firstUnit: diagnosticState?.units.values().next().value,
      taskResults: diagnosticConversation?.history.filter((h) => h.metadata?.toolName === "TaskUpdate").slice(0, 4).map((h) => h.content),
    })).toBeUndefined()
    expect(current).toBe(49)
    expect(harness.sessions.length).toBeGreaterThanOrEqual(3)
    expect(await readFile(path.join(fixture.root, "action-count.txt"), "utf8")).toBe("executed\n")
    const saved = await harness.conversations.get(result.conversationId)
    const turnId = saved?.contextHandoff?.turnId
    expect(turnId).toBeTypeOf("string")
    const state = await harness.repository.taskProgress!.state(result.conversationId, turnId!)
    expect(state.units.size).toBe(48)
    expect([...state.findings.values()].map((f) => f.value)).toEqual(Array.from({ length: 48 }, (_, n) => 1001 + n))
    expect(await harness.repository.taskProgress!.assessment(result.conversationId, turnId!)).toMatchObject({
      status: "coverage-complete", declaredUnits: 48, processedUnits: 48, conflictingFindings: 0, semanticCorrectness: "unverified",
    })
    expect(saved?.contextHandoff?.progressIndexPath).toBeTruthy()
    expect(saved?.contextHandoff?.pendingImages.every((i) => i.presented)).toBe(true)
    for (let n = 1; n <= 48; n += 1) expect(await readFile(unit(n).path)).toEqual(images[n - 1])
    expect(fixture.requestBytes.every((bytes) => bytes < 6 * 1024 * 1024)).toBe(true)
  } finally { await harness.close(); await fixture.close() }
}, 120_000)

it("gives false completion one correction, then reports an advisory evidence gap without failing the turn", async () => {
  let stage = 0
  const fixture = await createNativeSdkFixture(() => stage++ === 0 ? [{ name: "TaskCreate", id: "declare", input: {
    subject: "Read all", description: "Complete inventory", metadata: { synapseProgress: { version: 1, baseRevision: 0, seal: true,
      units: [{ id: "missing", kind: "image", path: path.join(fixture.root, "missing.png"), receipts: [], processed: false }] } },
  } }] : "PASS")
  const harness = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model" })
  try {
    const result = await harness.router.send(harness.message("Inspect the complete inventory."))
    expect(result.error).toBeUndefined()
    expect(fixture.requests).toHaveLength(3)
    const notice = (await harness.agentEvents.list({ conversationId: result.conversationId }))
      .findLast((entry) => entry.eventType === "error")
    expect(notice?.payload).toMatchObject({ errorKind: "task_evidence_incomplete", recoverable: true,
      taskCompletion: { status: "partial", declaredUnits: 1, processedUnits: 0 } })
    expect((await harness.conversations.get(result.conversationId))?.history.some((entry) => entry.metadata?.agentEventType === "error")).toBe(true)
  } finally { await harness.close(); await fixture.close() }
}, 30_000)

it("stops correcting once a compliance attempt changes no unit outcome", async () => {
  let stage = 0, revision = 0, attempt = 0
  const unit = () => ({ id: "page", path: path.join(fixture.root, "large.html"), kind: "text", receipts: [] as string[], processed: false })
  const fixture = await createNativeSdkFixture(() => {
    const step = stage++
    if (step === 0) return [{ name: "TaskCreate", id: "scope", input: { subject: "Verify the page", description: "Large page",
      metadata: { synapseProgress: { version: 1, baseRevision: revision++, seal: true, units: [unit()] } } } }]
    if (step === 1) return "第 1 步完成，页面已核对。"
    const phase = (step - 2) % 3
    if (phase === 0) {
      attempt += 1
      return [{ name: "Read", id: `head-${attempt}`, input: { file_path: unit().path, limit: 5 } }]
    }
    if (phase === 1) return [{ name: "TaskUpdate", id: `commit-${attempt}`, input: { taskId: "1", metadata: {
      synapseProgress: { version: 1, baseRevision: revision++, units: [{ ...unit(), receipts: [`head-${attempt}`] }] } } } }]
    return "第 1 步完成，页面已核对。"
  })
  await writeFile(unit().path, `<!doctype html>\n<div>EDIT-MARKER</div>\n${"filler line\n".repeat(4_000)}`)
  const harness = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model" })
  try {
    const result = await harness.router.send(harness.message("核对这个页面并说明结果。"))
    expect(result.error).toBeUndefined()
    // One correction, then an unchanged outcome ends the turn instead of re-reading forever.
    expect(fixture.requests).toHaveLength(5)
    const saved = await harness.conversations.get(result.conversationId)
    const state = await harness.repository.taskProgress!.state(result.conversationId, saved!.taskProgressScope!.turnId)
    expect([...state.units.values()][0]?.receipts).toEqual(["head-1"])
    const notice = (await harness.agentEvents.list({ conversationId: result.conversationId }))
      .findLast((entry) => entry.eventType === "error")
    expect(notice?.payload).toMatchObject({ errorKind: "task_evidence_incomplete", recoverable: true })
  } finally { await harness.close(); await fixture.close() }
}, 30_000)

it("presents a large pending batch in bounded clean groups before unrelated operations", async () => {
  let stage = 0, revision = 0, completed = 0, forbiddenAttempted = false
  const completedFiles = new Set<string>()
  let group: Array<{ n: number; id: string }> = []
  const unitFor = (n: number) => ({ id: `image-${n}`, path: path.join(fixture.root, `image-${n}.png`), kind: "image", receipts: [], processed: false })
  const fixture = await createNativeSdkFixture((request) => {
    if (stage++ === 0) return [{ name: "TaskCreate", id: "scope", input: { subject: "All images", description: "All 18 originals",
      metadata: { synapseProgress: { version: 1, baseRevision: revision++, units: Array.from({ length: 18 }, (_, i) => unitFor(i + 1)), seal: true } } } }]
    if (stage === 2) return [{ name: "Bash", id: "counter", input: { command: "printf 'once\\n' >> counter.txt" } }]
    if (stage === 3) return Array.from({ length: 18 }, (_, i) => ({ name: "Read", id: `original-${i + 1}`, input: { file_path: unitFor(i + 1).path } }))
    if (!forbiddenAttempted) {
      forbiddenAttempted = true
      return [{ name: "Bash", id: "must-not-run", input: { command: "printf 'bad\\n' >> forbidden.txt" } }]
    }
    if (group.length && group.every((row) => toolResult(request, row.id))) {
      completed += group.length
      group.forEach((row) => completedFiles.add(path.basename(unitFor(row.n).path)))
      const updates = group.map((row) => ({ ...unitFor(row.n), receipts: [row.id], processed: true }))
      group = []
      return [{ name: "TaskUpdate", id: `commit-${revision}`, input: { taskId: "1", metadata: { synapseProgress: { version: 1, baseRevision: revision++, units: updates } } } }]
    }
    if (completed === 18) return "All originals accounted for."
    const envelope = JSON.parse(readFileSync(path.join(fixture.root, "conversations.json"), "utf8")) as { items: Record<string, ConversationEntryV1> }
    const pending = Object.values(envelope.items)[0]!.contextHandoff!.pendingImages.filter((image) => !completedFiles.has(path.basename(image.path)))
    const selected = pending.filter((image) => image.attempts === 1)
    if (selected.length) {
      group = selected.map((image) => ({ n: Number(path.basename(image.path).match(/\d+/)![0]), id: `present-${image.toolUseId}` }))
      return group.map((row) => ({ name: "Read", id: row.id, input: { file_path: unitFor(row.n).path } }))
    }
    return [{ name: "Read", id: `deferred-${stage}`, input: { file_path: pending[0]!.path } }]
  })
  for (let n = 1; n <= 18; n += 1) await writeFile(unitFor(n).path, markedImage(String(1000 + n), n + 100, 720, 480))
  const harness = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model", firstImagePressure: true })
  try {
    const result = await harness.router.send(harness.message("Inspect all images, execute the counter once, and preserve progress."))
    const failedSnapshot = await harness.conversations.get(result.conversationId)
    expect(result.error, JSON.stringify({ completed, stage, sessions: harness.sessions.length,
      pending: failedSnapshot?.contextHandoff?.pendingImages.map((i) => ({ file: path.basename(i.path), attempts: i.attempts, presented: i.presented })),
      requestCount: fixture.requests.length,
    })).toBeUndefined()
    expect(completed).toBe(18)
    expect(harness.sessions.length).toBeGreaterThanOrEqual(3)
    expect(await readFile(path.join(fixture.root, "counter.txt"), "utf8")).toBe("once\n")
    expect(existsSync(path.join(fixture.root, "forbidden.txt"))).toBe(false)
    const saved = await harness.conversations.get(result.conversationId)
    expect(saved?.contextHandoff?.pendingImages).toHaveLength(18)
    expect(saved?.contextHandoff?.pendingImages.every((image) => image.attempts === 1 && image.presented)).toBe(true)
    expect(fixture.requestBytes.every((bytes) => bytes < 6 * 1024 * 1024)).toBe(true)
  } finally { await harness.close(); await fixture.close() }
}, 90_000)

it.each([false, true])("native text range receipts validate source versions (changed=%s)", async (changed) => {
  let stage = 0
  const fixture = await createNativeSdkFixture(() => {
    const file = path.join(fixture.root, "records.txt")
    const nativeUnit = { id: "records", path: file, kind: "text", receipts: [], processed: false }
    const metadata = (baseRevision: number, receipts: string[]) => ({ synapseProgress: { version: 1, baseRevision, seal: true,
      units: [{ ...nativeUnit, receipts, processed: receipts.length > 0 }] } })
    switch (stage++) {
      case 0: return [{ name: "TaskCreate", id: "scope", input: { subject: "Read records", description: "Every line", metadata: metadata(0, []) } }]
      case 1: return [{ name: "Read", id: "page-1", input: { file_path: file, offset: 1, limit: 2 } }]
      case 2: return [{ name: "TaskUpdate", id: "part", input: { taskId: "1", metadata: metadata(1, ["page-1"]) } }]
      case 3:
        if (changed) writeFileSync(file, "changed\nsecond\nthird\nfourth")
        return [{ name: "Read", id: "page-2", input: { file_path: file, offset: 3, limit: 2 } }]
      case 4: return [{ name: "TaskUpdate", id: "rest", input: { taskId: "1", metadata: metadata(2, ["page-2"]) } }]
      default: return "All four records were processed."
    }
  })
  await writeFile(path.join(fixture.root, "records.txt"), "first\nsecond\nthird\nfourth")
  const harness = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model" })
  try {
    const result = await harness.router.send(harness.message("Read all records and reconcile them."))
    expect(result.error).toBeUndefined()
    const notice = (await harness.agentEvents.list({ conversationId: result.conversationId }))
      .findLast((entry) => entry.eventType === "error")
    if (changed) expect(notice?.payload).toMatchObject({ errorKind: "task_evidence_incomplete", recoverable: true })
    else expect(notice).toBeUndefined()
  } finally { await harness.close(); await fixture.close() }
}, 30_000)

it.each([true, false])("native Stop gives repeated source output one correction (repaired=%s)", async (repaired) => {
  const paragraph = "A synthetic report paragraph referencing an immutable source receipt. ".repeat(4)
  const broken = `${paragraph}\n\n${paragraph}\n\n${paragraph}\n</think>`
  const fixture = await createNativeSdkFixture((_request, index) => index && repaired ? "Corrected report." : broken)
  const harness = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model" })
  try {
    const result = await harness.router.send(harness.message("Summarize the findings once."))
    expect(fixture.requests).toHaveLength(2)
    if (repaired) { expect(result.error).toBeUndefined(); expect(result.resultText).toBe("Corrected report.") }
    else expect(result.error).toContain("答复完整性检查未通过")
    const diagnostics = await harness.agentEvents.list({ conversationId: result.conversationId })
    expect(diagnostics.some((e) => e.payload.sdkType === "assistantOutputIntegrity"
      && (e.payload.payload as Record<string, unknown> | undefined)?.source === "sdk-assistant-message")).toBe(true)
  } finally { await harness.close(); await fixture.close() }
}, 30_000)

it("continues an unpresented saved text result after its reference cannot fit, without replaying an operation", async () => {
  let stage = 0, savedPath = ""
  const fixture = await createNativeSdkFixture((request) => {
    const unit = { id: "text", path: path.join(fixture.root, "records.txt"), kind: "text", receipts: [], processed: false }
    switch (stage++) {
      case 0: return [{ name: "TaskCreate", id: "scope", input: { subject: "All records", description: "Read the whole original",
        metadata: { synapseProgress: { version: 1, baseRevision: 0, units: [unit], seal: true } } } }]
      case 1: return [{ name: "Bash", id: "counter", input: { command: "printf 'once\\n' >> counter.txt" } }]
      case 2: return [{ name: "Read", id: "acquired", input: { file_path: unit.path } }]
      case 3: {
        expect(toolResult(request, "acquired")).toBeUndefined()
        const artifacts = JSON.parse(readFileSync(path.join(fixture.root, "agent.artifacts.json"), "utf8")) as { items: Record<string, { toolUseId?: string; storagePath: string }> }
        savedPath = Object.values(artifacts.items).find((row) => row.toolUseId === "acquired")!.storagePath
        return [{ name: "Read", id: "recovered", input: { file_path: savedPath } }]
      }
      case 4: return [{ name: "TaskUpdate", id: "commit", input: { taskId: "1", metadata: { synapseProgress: { version: 1,
        baseRevision: 1, units: [{ ...unit, receipts: ["recovered"], processed: true }] } } } }]
      default: return "All records read."
    }
  })
  await writeFile(path.join(fixture.root, "records.txt"), "alpha\nbeta\ngamma\ndelta\n")
  const harness = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model", firstTextPressure: true })
  try {
    const result = await harness.router.send(harness.message("Read all records and execute the counter once."))
    expect(result.error).toBeUndefined()
    expect(harness.sessions).toHaveLength(2)
    const saved = await harness.conversations.get(result.conversationId)
    const state = await harness.repository.taskProgress!.state(result.conversationId, saved!.taskProgressScope!.turnId)
    expect(state.receipts.get("acquired")?.presented).toBe(false)
    expect(state.receipts.get("recovered")).toMatchObject({ sourceReceiptId: "acquired", range: state.receipts.get("acquired")?.range, presented: true })
    expect(await harness.repository.taskProgress!.assessment(result.conversationId, saved!.taskProgressScope!.turnId)).toMatchObject({ status: "coverage-complete", processedUnits: 1 })
    expect(await readFile(path.join(fixture.root, "counter.txt"), "utf8")).toBe("once\n")
    expect(fixture.requestBytes.every((bytes) => bytes < 6 * 1024 * 1024)).toBe(true)
  } finally { await harness.close(); await fixture.close() }
}, 30_000)

it("replays a durable saved result in place without minting another artifact", async () => {
  let stage = 0, savedPath = ""
  const fixture = await createNativeSdkFixture((request) => {
    switch (stage++) {
      case 0: return [{ name: "Read", id: "acquired", input: { file_path: path.join(fixture.root, "records.txt") } }]
      case 1: {
        const artifacts = JSON.parse(readFileSync(path.join(fixture.root, "agent.artifacts.json"), "utf8")) as {
          items: Record<string, { toolUseId?: string; storagePath: string }> }
        savedPath = Object.values(artifacts.items).find((row) => row.toolUseId === "acquired")!.storagePath
        return [{ name: "Read", id: "replayed", input: { file_path: savedPath } }]
      }
      default: return "已读取保存的结果。"
    }
  })
  await writeFile(path.join(fixture.root, "records.txt"), "alpha beta gamma delta\n".repeat(8_000))
  const harness = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model", firstTextPressure: true })
  try {
    const result = await harness.router.send(harness.message("Read all records."))
    expect(result.error).toBeUndefined()
    expect(savedPath).not.toBe("")
    const artifacts = JSON.parse(readFileSync(path.join(fixture.root, "agent.artifacts.json"), "utf8")) as {
      items: Record<string, { toolUseId?: string }> }
    // The bounded re-read must reuse the stored result instead of storing a copy of it.
    expect(Object.values(artifacts.items).filter((row) => row.toolUseId)).toHaveLength(1)
    expect(fixture.requests.some((request) => JSON.stringify(request).includes("No new copy was saved"))).toBe(true)
    const saved = await harness.conversations.get(result.conversationId)
    const state = await harness.repository.taskProgress!.state(result.conversationId, saved!.taskProgressScope!.turnId)
    expect(state.receipts.get("replayed")).toMatchObject({ sourceReceiptId: "acquired", bounded: true })
  } finally { await harness.close(); await fixture.close() }
}, 30_000)

it("keeps a multi-file turn without any registered inventory advisory and non-failing", async () => {
  let stage = 0
  const fixture = await createNativeSdkFixture(() => stage++ === 0
    ? [1, 2].map((n) => ({ name: "Read", id: `read-${n}`, input: { file_path: path.join(fixture.root, `${n}.txt`) } }))
    : "PASS")
  for (const n of [1, 2]) await writeFile(path.join(fixture.root, `${n}.txt`), `marker-${n}`)
  const harness = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model" })
  try {
    const result = await harness.router.send(harness.message("Read and check both files."))
    expect(result.error).toBeUndefined()
    // Two natural model turns: the reads and the final answer. No inventory round trip.
    expect(fixture.requests).toHaveLength(2)
    const saved = await harness.conversations.get(result.conversationId)
    expect(saved?.history.some((entry) => entry.metadata?.agentEventType === "error")).toBe(false)
    expect(await harness.repository.taskProgress!.assessment(result.conversationId, saved!.taskProgressScope!.turnId))
      .toMatchObject({ status: "unverified", declaredUnits: 0 })
  } finally { await harness.close(); await fixture.close() }
}, 30_000)

it("treats a native edit receipt as processed evidence without failing the turn", async () => {
  let stage = 0, revision = 0
  const unit = () => ({ id: "page", path: path.join(fixture.root, "large.html"), kind: "text", receipts: [] as string[], processed: false })
  const fixture = await createNativeSdkFixture(() => {
    switch (stage++) {
      case 0: return [{ name: "TaskCreate", id: "scope", input: { subject: "Update the prototype page", description: "Large page",
        metadata: { synapseProgress: { version: 1, baseRevision: revision++, seal: true, units: [unit()] } } } }]
      case 1: return [{ name: "Read", id: "head", input: { file_path: unit().path, limit: 5 } }]
      case 2: return [{ name: "Edit", id: "edit-1", input: { file_path: unit().path,
        old_string: "EDIT-MARKER", new_string: "EDIT-MARKER-DONE" } }]
      case 3: return [{ name: "TaskUpdate", id: "commit", input: { taskId: "1", metadata: { synapseProgress: { version: 1,
        baseRevision: revision++, units: [{ ...unit(), receipts: ["head", "edit-1"], processed: true }] } } } }]
      default: return "第 4 步完成：编辑已执行，磁盘状态已核对。"
    }
  })
  const file = path.join(fixture.root, "large.html")
  await writeFile(file, `<!doctype html>\n<div>EDIT-MARKER</div>\n${"filler-line\n".repeat(4_000)}`)
  const harness = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model" })
  try {
    const result = await harness.router.send(harness.message("修改这个页面并说明结果。"))
    expect(result.error).toBeUndefined()
    expect(await readFile(file, "utf8")).toContain("EDIT-MARKER-DONE")
    const saved = await harness.conversations.get(result.conversationId)
    const state = await harness.repository.taskProgress!.state(result.conversationId, saved!.taskProgressScope!.turnId)
    expect(state.receipts.get("edit-1")?.mutation).toMatchObject({ toolName: "Edit", versionAfter: expect.any(String) })
    expect(await harness.repository.taskProgress!.assessment(result.conversationId, saved!.taskProgressScope!.turnId))
      .toMatchObject({ status: "partial", declaredUnits: 1, coveredUnits: 0, processedUnits: 1, mutatedUnits: 1 })
    const errors = (await harness.agentEvents.list({ conversationId: result.conversationId }))
      .filter((entry) => entry.eventType === "error")
    expect(errors).toHaveLength(0)
  } finally { await harness.close(); await fixture.close() }
}, 30_000)

it("does not force an inventory round trip for a two-file edit with limited reads", async () => {
  let stage = 0
  const fixture = await createNativeSdkFixture(() => {
    switch (stage++) {
      case 0: return [
        { name: "Read", id: "read-page", input: { file_path: path.join(fixture.root, "page.html"), limit: 5 } },
        { name: "Read", id: "read-side", input: { file_path: path.join(fixture.root, "side.html"), limit: 5 } },
      ]
      case 1: return [{ name: "Edit", id: "edit-page", input: { file_path: path.join(fixture.root, "page.html"),
        old_string: "EDIT-MARKER", new_string: "EDIT-MARKER-DONE" } }]
      default: return "已按要求只读开头并完成编辑。"
    }
  })
  const page = path.join(fixture.root, "page.html")
  const side = path.join(fixture.root, "side.html")
  for (const file of [page, side]) {
    await writeFile(file, `<!doctype html>\n<div>EDIT-MARKER</div>\n${"filler-line\n".repeat(2_000)}`)
  }
  const harness = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model" })
  try {
    const result = await harness.router.send(harness.message("只读开头 5 行，修改 page.html 的标记，不要整份读。"))
    expect(result.error).toBeUndefined()
    expect(await readFile(page, "utf8")).toContain("EDIT-MARKER-DONE")
    // Three natural model turns: two reads, one edit, then the final answer. No inventory round trip.
    expect(fixture.requests).toHaveLength(3)
    const delivered = JSON.stringify(fixture.requests)
    // The second material earns one optional note; registration is never demanded before proceeding.
    expect(delivered).not.toContain("before proceeding")
    expect(delivered).not.toContain("required for task coverage verification")
    // Delivered once, with the batch that read the second material, and never repeated per material.
    expect(JSON.stringify(fixture.requests[1]).split("Registering a coverage inventory").length - 1).toBe(1)
    const saved = await harness.conversations.get(result.conversationId)
    expect(saved?.history.some((entry) => entry.metadata?.agentEventType === "error")).toBe(false)
    expect(await harness.repository.taskProgress!.assessment(result.conversationId, saved!.taskProgressScope!.turnId))
      .toMatchObject({ status: "unverified", declaredUnits: 0 })
  } finally { await harness.close(); await fixture.close() }
}, 30_000)

it("keeps an unregistered multi-file coverage claim advisory without another model turn", async () => {
  let stage = 0
  const fixture = await createNativeSdkFixture(() => {
    switch (stage++) {
      case 0: return [
        { name: "Read", id: "read-page", input: { file_path: path.join(fixture.root, "page.html"), limit: 5 } },
        { name: "Read", id: "read-side", input: { file_path: path.join(fixture.root, "side.html"), limit: 5 } },
      ]
      case 1: return [{ name: "Edit", id: "edit-page", input: { file_path: path.join(fixture.root, "page.html"),
        old_string: "EDIT-MARKER", new_string: "EDIT-MARKER-DONE" } }]
      default: return "已通读全部文件，未遗漏，编辑完成。"
    }
  })
  const page = path.join(fixture.root, "page.html")
  const side = path.join(fixture.root, "side.html")
  for (const file of [page, side]) {
    await writeFile(file, `<!doctype html>\n<div>EDIT-MARKER</div>\n${"filler-line\n".repeat(2_000)}`)
  }
  const harness = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model" })
  try {
    const result = await harness.router.send(harness.message("只读开头 5 行，修改 page.html 的标记，不要整份读。"))
    expect(result.error).toBeUndefined()
    expect(fixture.requests).toHaveLength(3)
    const notice = (await harness.agentEvents.list({ conversationId: result.conversationId }))
      .findLast((entry) => entry.eventType === "error")
    expect(notice?.payload).toMatchObject({ errorKind: "task_evidence_incomplete", recoverable: true })
  } finally { await harness.close(); await fixture.close() }
}, 30_000)

it("denies the next original until the previous image has a durable processing commit", async () => {
  let stage = 0
  const unit = (n: number) => ({ id: String(n), path: path.join(fixture.root, `image-${n}.png`), kind: "image", receipts: [], processed: false })
  const fixture = await createNativeSdkFixture((request) => {
    const commit = (n: number, id: string) => [{ name: "TaskUpdate", id: `commit-${n}`, input: { taskId: "1", metadata: {
      synapseProgress: { version: 1, baseRevision: n, units: [{ ...unit(n), receipts: [id], processed: true }] } } } }]
    switch (stage++) {
      case 0: return [{ name: "TaskCreate", id: "scope", input: { subject: "Both images", description: "Inspect both", metadata: {
        synapseProgress: { version: 1, baseRevision: 0, units: [unit(1), unit(2)], seal: true } } } }]
      case 1: return [{ name: "Read", id: "first", input: { file_path: realpathSync(unit(1).path) } }]
      case 2: return [{ name: "Read", id: "premature", input: { file_path: realpathSync(unit(2).path) } }]
      case 3:
        expect(toolResult(request, "premature")).toMatchObject({ is_error: true })
        return commit(1, "first")
      case 4: return [{ name: "Read", id: "second", input: { file_path: realpathSync(unit(2).path) } }]
      case 5: return commit(2, "second")
      default: return "Both images processed."
    }
  })
  for (const n of [1, 2]) await writeFile(unit(n).path, markedImage(String(1000 + n), n + 101, 720, 480))
  const harness = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model" })
  try {
    const result = await harness.router.send(harness.message("Inspect both original images."))
    expect(result.error).toBeUndefined()
    const saved = await harness.conversations.get(result.conversationId)
    const state = await harness.repository.taskProgress!.state(result.conversationId, saved!.taskProgressScope!.turnId)
    expect(state.receipts.has("premature")).toBe(false)
    expect(state.units.get("1")?.processed).toBe(true)
    expect(state.units.get("2")?.processed).toBe(true)
  } finally { await harness.close(); await fixture.close() }
}, 30_000)

it("checks whether PostToolBatch exposes a later hook's actual replacement", async () => {
  const batches: unknown[] = []
  const fixture = await createNativeSdkFixture((_, index) => index === 0
    ? [{ name: "Read", id: "read", input: { file_path: path.join(fixture.root, "source.txt") } }] : "Done")
  await writeFile(path.join(fixture.root, "source.txt"), "original")
  const run = fixture.start({ tools: ["Read"], hooks: {
    PostToolUse: [{ hooks: [async (input) => {
      if (input.hook_event_name !== "PostToolUse") return {}
      const response = input.tool_response as { file: Record<string, unknown> }
      return { hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: { ...response, file: { ...response.file, content: "changed" } } } }
    }] }],
    PostToolBatch: [{ hooks: [async (input) => { if (input.hook_event_name === "PostToolBatch") batches.push(input.tool_calls); return {} }] }],
  } })
  try {
    expect(await collectNativeResult(run)).toMatchObject({ is_error: false })
    expect(JSON.stringify(toolResult(fixture.requests[1], "read"))).toContain("changed")
    expect(batches).toEqual([[expect.objectContaining({ tool_use_id: "read", tool_response: "1\tchanged" })]])
  } finally { await fixture.close() }
}, 15_000)

it("fails before another request if another hook changes the acquired source after governance", async () => {
  const fixture = await createNativeSdkFixture((_, index) => index === 0
    ? [{ name: "Read", id: "read", input: { file_path: path.join(fixture.root, "source.txt") } }] : "False success")
  await writeFile(path.join(fixture.root, "source.txt"), "original")
  const harness = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model",
    afterReadHook: async (input) => {
      if (input.hook_event_name !== "PostToolUse") return {}
      const response = input.tool_response as { file: Record<string, unknown> }
      return { hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: { ...response, file: { ...response.file, content: "changed" } } } }
    } })
  try {
    const result = await harness.router.send(harness.message("Read the complete original."))
    expect(result.error).toContain("读取结果在交付前发生变化")
    expect(fixture.requests).toHaveLength(1)
    const saved = await harness.conversations.get(result.conversationId)
    const state = await harness.repository.taskProgress!.state(result.conversationId, saved!.taskProgressScope!.turnId)
    expect(state.receipts.get("read")?.presented).toBe(false)
  } finally { await harness.close(); await fixture.close() }
}, 30_000)

it("native image batch carries the same bytes as the request", async () => {
  let response: unknown
  const fixture = await createNativeSdkFixture((_, index) => index === 0
    ? [{ name: "Read", id: "read", input: { file_path: path.join(fixture.root, "image.png") } }] : "Done")
  await writeFile(path.join(fixture.root, "image.png"), markedImage("1234", 7, 720, 480))
  const run = fixture.start({ tools: ["Read"], hooks: { PostToolBatch: [{ hooks: [async (input) => {
    if (input.hook_event_name === "PostToolBatch") response = input.tool_calls[0]?.tool_response
    return {}
  }] }] } })
  try {
    await collectNativeResult(run)
    expect(response).toEqual((toolResult(fixture.requests[1], "read") as { content: unknown }).content)
    expect(response).toEqual([{ type: "image", source: { type: "base64", media_type: "image/png",
      data: (await readFile(path.join(fixture.root, "image.png"))).toString("base64") } }])
  } finally { await fixture.close() }
}, 15_000)

it.each([
  ["source.ts", "export const value = 1\n"],
  ["records.json", '\uFEFF{\r\n  "value": 1\r\n}\r\n'],
  ["empty.txt", ""],
])("accepts native text formatting without inventing source changes: %s", async (filename, content) => {
  let stage = 0
  const unit = { id: "source", path: "", kind: "text", receipts: [], processed: false }
  const fixture = await createNativeSdkFixture(() => {
    if (stage++ === 0) return [{ name: "TaskCreate", id: "scope", input: { subject: "Read original", description: "Read all", metadata: {
      synapseProgress: { version: 1, baseRevision: 0, units: [unit], seal: true } } } }]
    if (stage === 2) return [{ name: "Read", id: "read", input: { file_path: unit.path } }]
    if (stage === 3) return [{ name: "TaskUpdate", id: "commit", input: { taskId: "1", metadata: {
      synapseProgress: { version: 1, baseRevision: 1, units: [{ ...unit, receipts: ["read"], processed: true }] } } } }]
    return "All content read."
  })
  unit.path = path.join(fixture.root, filename)
  await writeFile(unit.path, content)
  const harness = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model" })
  try {
    const result = await harness.router.send(harness.message("Read the complete original."))
    expect(result.error).toBeUndefined()
    const saved = await harness.conversations.get(result.conversationId)
    expect(await harness.repository.taskProgress!.assessment(result.conversationId, saved!.taskProgressScope!.turnId))
      .toMatchObject({ status: "coverage-complete", processedUnits: 1 })
  } finally { await harness.close(); await fixture.close() }
}, 30_000)

it("native empty Read delivery contract", async () => {
  let raw: unknown
  let response: unknown
  const fixture = await createNativeSdkFixture((_, index) => index === 0
    ? [{ name: "Read", id: "empty", input: { file_path: path.join(fixture.root, "empty.txt") } }] : "Done")
  await writeFile(path.join(fixture.root, "empty.txt"), "")
  const run = fixture.start({ tools: ["Read"], hooks: { PostToolUse: [{ hooks: [async (input) => { if (input.hook_event_name === "PostToolUse") raw = input.tool_response; return {} }] }], PostToolBatch: [{ hooks: [async (input) => {
    if (input.hook_event_name === "PostToolBatch") response = input.tool_calls[0]?.tool_response
    return {}
  }] }] } })
  try { await collectNativeResult(run); expect(raw).toMatchObject({ type: "text", file: { content: "", startLine: 1, numLines: 1, totalLines: 1 } }); expect(response).toEqual("<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>") } finally { await fixture.close() }
}, 15_000)

it("retains presentation evidence when malformed next tool input bypasses PreToolUse", async () => {
  let stage = 0
  const unit = { id: "source", path: "", kind: "image", receipts: [], processed: false }
  const fixture = await createNativeSdkFixture(() => {
    if (stage++ === 0) return [{ name: "TaskCreate", id: "scope", input: { subject: "Read original", description: "Read all", metadata: {
      synapseProgress: { version: 1, baseRevision: 0, units: [unit], seal: true } } } }]
    if (stage === 2) return [{ name: "Read", id: "read", input: { file_path: unit.path } }]
    if (stage === 3) return [{ name: "TaskUpdate", id: "invalid", input: {} }]
    if (stage === 4) return [{ name: "TaskUpdate", id: "commit", input: { taskId: "1", metadata: {
      synapseProgress: { version: 1, baseRevision: 1, units: [{ ...unit, receipts: ["read"], processed: true }] } } } }]
    return "Complete."
  })
  unit.path = path.join(fixture.root, "image.png")
  await writeFile(unit.path, markedImage("1234", 7))
  const harness = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model" })
  try {
    const result = await harness.router.send(harness.message("Read the original."))
    expect(result.error).toBeUndefined()
    expect(fixture.requests).toHaveLength(5)
    const saved = await harness.conversations.get(result.conversationId)
    const assessment = await harness.repository.taskProgress!.assessment(result.conversationId, saved!.taskProgressScope!.turnId)
    expect(assessment).toMatchObject({ status: "coverage-complete", processedUnits: 1 })
  } finally { await harness.close(); await fixture.close() }
}, 30_000)

it("repairs a premature inventory seal through native task feedback without rereading originals", async () => {
  let stage = 0
  const unit = (n: number) => ({ id: String(n), path: path.join(fixture.root, `${n}.txt`), kind: "text", receipts: [`read-${n}`], processed: true })
  const fixture = await createNativeSdkFixture((request) => {
    if (stage++ === 0) return [1, 2].map((n) => ({ name: "Read", id: `read-${n}`, input: { file_path: unit(n).path } }))
    if (stage === 2) return [{ name: "TaskCreate", id: "partial", input: { subject: "Both originals", description: "Read both", metadata: {
      synapseProgress: { version: 1, baseRevision: 0, units: [unit(2)], seal: true } } } }]
    if (stage === 3) {
      expect(JSON.stringify(request)).toContain("清单尚未包含")
      return [{ name: "TaskUpdate", id: "corrected", input: { taskId: "1", metadata: {
        synapseProgress: { version: 1, baseRevision: 0, units: [unit(1), unit(2)], seal: true } } } }]
    }
    return "Both originals processed."
  })
  for (const n of [1, 2]) await writeFile(unit(n).path, `source-${n}`)
  const harness = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model" })
  try {
    const result = await harness.router.send(harness.message("Inspect both complete originals."))
    expect(result.error).toBeUndefined()
    expect(fixture.requests).toHaveLength(4)
    const saved = await harness.conversations.get(result.conversationId)
    expect(await harness.repository.taskProgress!.assessment(result.conversationId, saved!.taskProgressScope!.turnId))
      .toMatchObject({ status: "coverage-complete", declaredUnits: 2, processedUnits: 2 })
    expect(saved!.history.filter((row) => row.metadata?.agentEventType === "toolUse" && row.metadata.toolName === "Read")).toHaveLength(2)
  } finally { await harness.close(); await fixture.close() }
}, 30_000)

it("external cancellation during native Read acknowledges interrupt before aborting the SDK transport", async () => {
  const controller = new AbortController()
  const fixture = await createNativeSdkFixture((_, index) => index === 0
    ? [{ name: "Bash", id: "once", input: { command: "printf 'once\\n' >> counter.txt" } }]
    : index === 1 ? [{ name: "Read", id: "read", input: { file_path: path.join(fixture.root, "image.png") } }] : "Unexpected request")
  await writeFile(path.join(fixture.root, "image.png"), markedImage("1234", 7))
  const harness = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model",
    afterReadHook: async () => { controller.abort(); return {} } })
  try {
    const result = await harness.router.send(harness.message("Run the counter once and read the image."), { abortSignal: controller.signal })
    expect(result.error).toContain("已停止")
    await expect(harness.sessions[0]!.close()).resolves.toBeUndefined()
    expect(harness.sessions).toHaveLength(1)
    expect(fixture.requests).toHaveLength(2)
    expect(await readFile(path.join(fixture.root, "counter.txt"), "utf8")).toBe("once\n")
    expect(harness.logs.some((row) => row.message.includes("close failed") || row.message.includes("unconfirmed"))).toBe(false)
  } finally { await harness.close(); await fixture.close() }
}, 30_000)

it("does not force generated output verification into an already sealed input inventory", async () => {
  let stage = 0
  const unit = { id: "input", path: "", kind: "text", receipts: [] as string[], processed: false }
  const fixture = await createNativeSdkFixture(() => {
    switch (stage++) {
      case 0: return [{ name: "TaskCreate", id: "scope", input: { subject: "Process input", description: "Read input and write output", metadata: {
        synapseProgress: { version: 1, baseRevision: 0, units: [unit], seal: true } } } }]
      case 1: return [{ name: "Read", id: "input", input: { file_path: unit.path } }]
      case 2: return [{ name: "TaskUpdate", id: "processed", input: { taskId: "1", metadata: {
        synapseProgress: { version: 1, baseRevision: 1, units: [{ ...unit, receipts: ["input"], processed: true }] } } } }]
      case 3: return [{ name: "Bash", id: "write", input: { command: "printf 'verified\\n' > output.txt" } }]
      case 4: return [{ name: "Read", id: "check-output", input: { file_path: path.join(fixture.root, "output.txt") } }]
      case 5: return [{ name: "TaskUpdate", id: "sealed-again", input: { taskId: "1", metadata: {
        synapseProgress: { version: 1, baseRevision: 2, seal: true } } } }]
      default: return "Input processed and output checked."
    }
  })
  unit.path = path.join(fixture.root, "input.txt")
  await writeFile(unit.path, "original")
  const harness = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model" })
  try {
    const result = await harness.router.send(harness.message("Read input.txt and create output.txt, then verify the output."))
    expect(result.error).toBeUndefined()
    expect(fixture.requests).toHaveLength(7)
    const saved = await harness.conversations.get(result.conversationId)
    expect(await harness.repository.taskProgress!.assessment(result.conversationId, saved!.taskProgressScope!.turnId))
      .toMatchObject({ status: "coverage-complete", declaredUnits: 1, processedUnits: 1 })
  } finally { await harness.close(); await fixture.close() }
}, 30_000)


it("native Read verifies Unicode/space paths and CRLF text across platform path spellings", async () => {
  let stage = 0
  const fixture = await createNativeSdkFixture(() => {
    const file = path.join(fixture.root, "资料 空格 #.txt")
    const unit = { id: "text", kind: "text", path: file, receipts: [], processed: false }
    if (stage++ === 0) return [{ name: "TaskCreate", id: "scope", input: { subject: "Verify text", description: "Unicode original",
      metadata: { synapseProgress: { version: 1, baseRevision: 0, units: [unit], seal: true } } } }]
    if (stage === 2) return [{ name: "Read", id: "read", input: { file_path: file.replaceAll("\\", "/") } }]
    if (stage === 3) return [{ name: "TaskUpdate", id: "finish", input: { taskId: "1", metadata: {
      synapseProgress: { version: 1, baseRevision: 1, units: [{ ...unit, path: existsSync(file.replace(/\.txt$/, ".TXT")) ? file.replace(/\.txt$/, ".TXT") : file, receipts: ["read"], processed: true }] },
    } } }]
    return "Done"
  })
  await writeFile(path.join(fixture.root, "资料 空格 #.txt"), "\uFEFF第一行\r\nsecond line\r\n")
  const harness = imageRuntimeHarness({ root: fixture.root, env: fixture.env as Record<string, string>, model: "fixture-model" })
  try {
    const result = await harness.router.send(harness.message("Read the original and keep its evidence."))
    expect(result.error).toBeUndefined()
    expect(fixture.requests).toHaveLength(4)
    expect(JSON.stringify(toolResult(fixture.requests[2], "read"))).toContain("第一行")
    const saved = await harness.conversations.get(result.conversationId)
    expect(await harness.repository.taskProgress!.assessment(result.conversationId, saved!.taskProgressScope!.turnId))
      .toMatchObject({ status: "coverage-complete", declaredUnits: 1, coveredUnits: 1, processedUnits: 1 })
  } finally { await harness.close(); await fixture.close() }
}, 30_000)
