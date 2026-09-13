import { writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, it } from "vitest"
import { collectNativeResult, createNativeSdkFixture, toolResult } from "./fixtures/native-sdk-fixture"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} did not settle`)), 5000)
    })])
  } finally { clearTimeout(timer) }
}

it("keeps two concurrent Read replacements associated with tool_use_id despite reverse hook completion", async () => {
  const secondFinished = deferred()
  const order: string[] = []
  const fixture = await createNativeSdkFixture((_request, index) => index === 0 ? [
    { id: "read_a", name: "Read", input: { file_path: path.join(fixture.root, "a.txt") } },
    { id: "read_b", name: "Read", input: { file_path: path.join(fixture.root, "b.txt") } },
  ] : "Read complete")
  await writeFile(path.join(fixture.root, "a.txt"), "original-a")
  await writeFile(path.join(fixture.root, "b.txt"), "original-b")
  const run = fixture.start({ tools: ["Read"], hooks: { PostToolUse: [{ hooks: [async (input) => {
    if (input.hook_event_name !== "PostToolUse") return {}
    if (input.tool_use_id === "read_a") await bounded(secondFinished.promise, "parallel Read")
    order.push(input.tool_use_id)
    if (input.tool_use_id === "read_b") secondFinished.resolve()
    const response = input.tool_response as { file: Record<string, unknown> }
    return { hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: {
      ...response, file: { ...response.file, content: `replacement-${input.tool_use_id}` },
    } } }
  }] }] } })
  try {
    expect(await collectNativeResult(run)).toMatchObject({ is_error: false })
    expect(order).toEqual(["read_b", "read_a"])
    for (const id of ["read_a", "read_b"]) {
      const result = JSON.stringify(toolResult(fixture.requests[1], id))
      expect(result).toContain(`replacement-${id}`)
      expect(result).not.toContain("original-")
    }
  } finally { secondFinished.resolve(); await fixture.close() }
}, 15_000)

it.each(["interrupt", "interrupt-then-close"] as const)("%s settles while PostToolBatch is paused without sending another request", async (action) => {
  const entered = deferred()
  const release = deferred()
  let snapshotTokens: number | undefined
  const fixture = await createNativeSdkFixture((_request, index) => index === 0
    ? [{ name: "TaskList", input: {}, id: "task_list" }] : "Unexpected extra request")
  const run = fixture.start({ tools: ["TaskList"], hooks: { PostToolBatch: [{ hooks: [async () => {
    snapshotTokens = (await bounded(run.getContextUsage(), "context snapshot")).totalTokens
    entered.resolve()
    await release.promise
    return { continue: false, suppressOutput: true }
  }] }] } })
  const terminal = collectNativeResult(run).then((result) => ({ result }), (error: unknown) => ({ error }))
  try {
    await bounded(entered.promise, "PostToolBatch entry")
    expect(snapshotTokens).toBeGreaterThan(0)
    await bounded(run.interrupt(), "interrupt")
    if (action === "interrupt-then-close") run.close()
    release.resolve()
    await bounded(terminal, "cancelled native result")
    expect(fixture.requests).toHaveLength(1)
  } finally { release.resolve(); await fixture.close() }
}, 15_000)

it.each(["throw", "timeout"] as const)("records that a Stop hook %s is not a host completion receipt", async (failure) => {
  const release = deferred()
  let stops = 0
  const fixture = await createNativeSdkFixture(() => "Unverified final output")
  const run = fixture.start({ tools: [], hooks: { Stop: [{ timeout: 0.1, hooks: [async () => {
    stops += 1
    if (failure === "throw") throw new Error("Fixture verifier unavailable")
    await release.promise
    return {}
  }] }] } })
  try {
    const result = await bounded(collectNativeResult(run), "Stop failure result")
    expect(stops).toBe(1)
    expect(result).toMatchObject({ is_error: false })
    expect(fixture.requests).toHaveLength(1)
  } finally { release.resolve(); await fixture.close() }
}, 15_000)

it("observes native compact hooks and boundary on the existing session", async () => {
  const order: string[] = []
  const fixture = await createNativeSdkFixture((_request, index) => index < 4
    ? [{ name: "TaskList", input: {}, id: `compact_task_${index}` }]
    : "Fixture compact summary: preserve requirements and receipts.")
  let sessionId = ""
  const initial = fixture.start({ tools: ["TaskList"] })
  try {
    const result = await collectNativeResult(initial)
    sessionId = result.session_id
    initial.close()
    const run = fixture.start({ tools: [], resume: sessionId, hooks: {
      PreCompact: [{ hooks: [async () => { order.push("pre"); return {} }] }],
      PostCompact: [{ hooks: [async (input) => {
        order.push("post")
        expect(input).toMatchObject({ hook_event_name: "PostCompact", compact_summary: expect.any(String) })
        return {}
      }] }],
    } }, "/compact")
    for await (const event of run) {
      if (event.type === "system" && event.subtype === "compact_boundary") order.push("boundary")
      if (event.type === "result") { expect(event).toMatchObject({ is_error: false }); break }
    }
    expect(order).toEqual(["pre", "post", "boundary"])
  } finally { await fixture.close() }
}, 15_000)

it("preserves an error result when the native turn budget ends before completion", async () => {
  let stops = 0
  const fixture = await createNativeSdkFixture(() => [{ name: "TaskList", input: {}, id: "limit_task" }])
  const run = fixture.start({ tools: ["TaskList"], maxTurns: 1, hooks: { Stop: [{ hooks: [async () => { stops += 1; return {} }] }] } })
  try {
    expect(await collectNativeResult(run)).toMatchObject({ is_error: true, subtype: "error_max_turns" })
    expect(stops).toBe(0)
  } finally { await fixture.close() }
}, 15_000)

it("surfaces dropped SessionStore mirror batches without making them completion receipts", async () => {
  let attempts = 0
  let mirrorsFailed = 0
  let terminal: unknown
  const fixture = await createNativeSdkFixture(() => "Mirror fixture completed")
  const run = fixture.start({ tools: [], sessionStoreFlush: "eager", sessionStore: {
    async append() { attempts += 1; throw new Error("Fixture mirror write unavailable") },
    async load() { return null },
  } })
  try {
    await bounded((async () => {
      for await (const event of run) {
        if (event.type === "system" && event.subtype === "mirror_error") mirrorsFailed += 1
        if (event.type === "result") terminal = event
      }
    })(), "mirror completion")
    expect(terminal).toMatchObject({ is_error: false })
    expect(attempts).toBeGreaterThanOrEqual(3)
    expect(mirrorsFailed).toBeGreaterThan(0)
  } finally { await fixture.close() }
}, 15_000)

it("checks request-observed content after another PostToolUse hook changes the same Read result", async () => {
  const fixture = await createNativeSdkFixture((_request, index) => index === 0
    ? [{ name: "Read", id: "multi_hook", input: { file_path: path.join(fixture.root, "source.txt") } }] : "Hooks complete")
  await writeFile(path.join(fixture.root, "source.txt"), "original-hook-canary")
  const run = fixture.start({ tools: ["Read"], hooks: { PostToolUse: [{ hooks: [
    async (input) => {
      if (input.hook_event_name !== "PostToolUse") return {}
      const response = input.tool_response as { file: Record<string, unknown> }
      return { hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: {
        ...response, file: { ...response.file, content: "host-prepared-canary" },
      } } }
    },
    async (input) => {
      if (input.hook_event_name !== "PostToolUse") return {}
      const response = input.tool_response as { file: Record<string, unknown> }
      return { hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: {
        ...response, file: { ...response.file, content: "other-hook-canary" },
      } } }
    },
  ] }] } })
  try {
    expect(await collectNativeResult(run)).toMatchObject({ is_error: false })
    const observed = JSON.stringify(toolResult(fixture.requests[1], "multi_hook"))
    expect(observed).toContain("other-hook-canary")
    expect(observed).not.toContain("host-prepared-canary")
  } finally { await fixture.close() }
}, 15_000)

it("retains mirror batches across a delayed adapter acknowledgment", async () => {
  const entered = deferred()
  const release = deferred()
  let persisted = 0
  const fixture = await createNativeSdkFixture(() => "Delayed mirror fixture")
  const run = fixture.start({ tools: [], sessionStoreFlush: "eager", sessionStore: {
    async append(_key, entries) { entered.resolve(); await release.promise; persisted += entries.length },
    async load() { return null },
  } })
  const result = collectNativeResult(run)
  try {
    await bounded(entered.promise, "mirror entry")
    expect(persisted).toBe(0)
    release.resolve()
    expect(await bounded(result, "mirror acknowledgment")).toMatchObject({ is_error: false })
    expect(persisted).toBeGreaterThan(0)
  } finally { release.resolve(); await fixture.close() }
}, 15_000)
