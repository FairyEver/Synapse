import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, it } from "vitest"
import { collectNativeResult, createNativeSdkFixture, toolResult } from "./fixtures/native-sdk-fixture"

// Synthetic 1x1 PNG. Byte delivery only; this fixture makes no visual-understanding claim.
const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF3sAAAAASUVORK5CYII=", "base64")

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function bounded<T>(promise: Promise<T>, stage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Native image fixture timed out: ${stage}`)), 5000)
    })])
  } finally { clearTimeout(timer) }
}

it.each(["interrupt", "interrupt-then-close", "hook-stop"] as const)("pauses a native image in PostToolUse, %s stops delivery, and a clean query reads the same original", async (action) => {
  const entered = deferred()
  const release = deferred()
  let generation = 0
  let readResponse: unknown
  const fixture = await createNativeSdkFixture((_request, index) => index === generation
    ? [{ name: "Read", id: `image_${generation}`, input: { file_path: path.join(fixture.root, "original.png") } }]
    : "Image delivery fixture complete")
  const filePath = path.join(fixture.root, "original.png")
  await writeFile(filePath, imageBytes)
  const originalDigest = createHash("sha256").update(imageBytes).digest("hex")
  const abortController = new AbortController()
  const run = fixture.start({ abortController, tools: ["Read"], hooks: { PostToolUse: [{ hooks: [async (input) => {
    if (input.hook_event_name !== "PostToolUse") return {}
    readResponse = input.tool_response
    // Persistence must finish while the native result is still held at the hook.
    await writeFile(path.join(fixture.root, "pending.json"), JSON.stringify({
      originalToolUseId: input.tool_use_id, generation: 0, resourceDigest: originalDigest, evidence: "acquired",
    }))
    entered.resolve()
    await release.promise
    return { continue: false, suppressOutput: true }
  }] }] } })
  const terminal = collectNativeResult(run).then((result) => ({ result }), (error: unknown) => ({ error }))
  try {
    await bounded(entered.promise, "PostToolUse entry")
    expect(readResponse).toMatchObject({ type: "image" })
    expect(JSON.parse(await readFile(path.join(fixture.root, "pending.json"), "utf8"))).toMatchObject({
      originalToolUseId: "image_0", evidence: "acquired",
    })
    expect(fixture.requests).toHaveLength(1)
    if (action !== "hook-stop") await bounded(run.interrupt(), "interrupt while hook is pending")
    if (action === "interrupt-then-close") run.close()
    release.resolve()
    await bounded(terminal, "old query termination")
    expect(fixture.requests).toHaveLength(1)
    expect(createHash("sha256").update(await readFile(filePath)).digest("hex")).toBe(originalDigest)

    generation = fixture.requests.length
    const next = fixture.start({ tools: ["Read"] })
    expect(await bounded(collectNativeResult(next), "clean query presentation")).toMatchObject({ is_error: false })
    const result = toolResult(fixture.requests[2], "image_1") as { content?: Array<{ type: string; source?: { data?: string } }> }
    const image = result?.content?.find((block) => block.type === "image")
    expect(image?.source?.data).toBeDefined()
    expect(Buffer.from(image!.source!.data!, "base64")).toEqual(imageBytes)
    expect(fixture.requests).toHaveLength(3)
  } finally {
    release.resolve()
    await fixture.close()
  }
}, 20_000)

// This is a reproduction of an SDK protocol defect, NOT an I06 acceptance pass.
// Keep automatic image handoff disabled until forced termination has a proven barrier.
it("reproduces native close releasing a pending image into an extra request without interrupt acknowledgement", async () => {
  const entered = deferred()
  const release = deferred()
  const fixture = await createNativeSdkFixture((_request, index) => index === 0
    ? [{ name: "Read", id: "unsafe_close_image", input: { file_path: path.join(fixture.root, "original.png") } }]
    : "Unexpected request after close")
  await writeFile(path.join(fixture.root, "original.png"), imageBytes)
  const run = fixture.start({ tools: ["Read"], hooks: { PostToolUse: [{ hooks: [async () => {
    entered.resolve()
    await release.promise
    return { continue: false, suppressOutput: true }
  }] }] } })
  const terminal = collectNativeResult(run).then((result) => ({ result }), (error: unknown) => ({ error }))
  try {
    await bounded(entered.promise, "unsafe close entry")
    run.close()
    release.resolve()
    await bounded(terminal, "unsafe close termination")
    expect(fixture.requests).toHaveLength(2)
    const leaked = toolResult(fixture.requests[1], "unsafe_close_image")
    expect(leaked).toMatchObject({ content: expect.arrayContaining([expect.objectContaining({ type: "image" })]) })
  } finally { release.resolve(); await fixture.close() }
}, 15_000)
