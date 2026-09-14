import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, it } from "vitest"
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk"
import { replaceToolOutput } from "../tool-output-governor"

interface FixtureRequest {
  messages: Array<{ content?: unknown }>
  tools?: Array<{ name: string }>
}

function toolResultBlock(request: FixtureRequest | undefined, toolUseId: string): unknown {
  return request?.messages.flatMap((message) => Array.isArray(message.content) ? message.content : [])
    .find((block) => (block as { type?: string; tool_use_id?: string })?.type === "tool_result"
      && (block as { tool_use_id?: string }).tool_use_id === toolUseId)
}

// Real installed SDK/native executable, deterministic loopback responses only.
// Never inherit user credentials, settings, MCP servers or task directories.
it("verifies native Read replacement, Stop blocking and task namespace continuity against a local protocol fixture", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-sdk-contract-"))
  const taskListId = randomUUID()
  const requests: FixtureRequest[] = []
  const tools = [
    { name: "Read", input: { file_path: path.join(root, "source.txt") } },
    { name: "Bash", input: { command: "printf original-bash-canary" } },
    { name: "mcp__fixture__echo", input: {} },
    { name: "TaskCreate", input: { subject: "Retain this task", description: "Protocol fixture" } },
    { name: "TaskList", input: {} },
  ]
  let requestBytes = 0
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks)
    requestBytes = Math.max(requestBytes, body.byteLength)
    if (!req.url?.startsWith("/v1/messages")) {
      res.writeHead(404).end()
      return
    }
    if (req.url.includes("count_tokens")) {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ input_tokens: 1000 }))
      return
    }
    const request = JSON.parse(body.toString()) as typeof requests[number]
    requests.push(request)
    const step = tools[requests.length - 1]
    const id = `msg_${requests.length}`
    res.writeHead(200, { "Content-Type": "text/event-stream" })
    const emit = (type: string, data: Record<string, unknown>) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
    emit("message_start", { message: { id, type: "message", role: "assistant", model: "fixture-model", content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 0 } } })
    emit("content_block_start", { index: 0, content_block: step
      ? { type: "tool_use", id: `tool_${requests.length}`, name: step.name, input: {} }
      : { type: "text", text: "" } })
    emit("content_block_delta", { index: 0, delta: step
      ? { type: "input_json_delta", partial_json: JSON.stringify(step.input) }
      : { type: "text_delta", text: "Fixture complete" } })
    emit("content_block_stop", { index: 0 })
    emit("message_delta", { delta: { stop_reason: step ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } })
    emit("message_stop", {})
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Loopback fixture did not start")
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    CLAUDE_CONFIG_DIR: path.join(root, "config"),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
    ANTHROPIC_API_KEY: "fixture-key",
    CLAUDE_CODE_TASK_LIST_ID: taskListId,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  }
  let stops = 0
  let replacements = 0
  const batches: string[][] = []
  const snapshots: number[] = []
  await writeFile(path.join(root, "source.txt"), "original-read-canary")
  const run = query({ prompt: "Run the local protocol fixture", options: {
    cwd: root, env, settingSources: [], strictMcpConfig: true, mcpServers: {
      fixture: createSdkMcpServer({ name: "fixture", tools: [tool("echo", "Local fixture", {}, async () => ({
        content: [{ type: "text" as const, text: "original-mcp-canary" }], structuredContent: { content: "original-mcp-canary" },
      }))] }),
    },
    model: "fixture-model", tools: ["Read", "Bash", "TaskCreate", "TaskList"], maxTurns: 10,
    permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true,
    hooks: {
      PostToolUse: [{ matcher: "Read|Bash|mcp__fixture__echo", hooks: [async (input) => {
        if (input.hook_event_name !== "PostToolUse") return {}
        replacements += 1
        const marker = input.tool_name === "Read" ? "delivered-read-canary"
          : input.tool_name === "Bash" ? "delivered-bash-canary" : "delivered-mcp-canary"
        return { hookSpecificOutput: {
          hookEventName: "PostToolUse" as const, updatedToolOutput: replaceToolOutput(input.tool_name, input.tool_response, marker),
        } }
      }] }],
      PostToolBatch: [{ hooks: [async (input) => {
        if (input.hook_event_name === "PostToolBatch") batches.push(input.tool_calls.map((call) => call.tool_name))
        let timeout: ReturnType<typeof setTimeout> | undefined
        try {
          const snapshot = await Promise.race([run.getContextUsage(), new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error("Native context snapshot blocked inside PostToolBatch")), 5000)
          })])
          snapshots.push(snapshot.totalTokens)
        } finally {
          clearTimeout(timeout)
        }
        return {}
      }] }],
      Stop: [{ hooks: [async () => ++stops === 1
        ? { decision: "block" as const, reason: "One more fixture response is required" } : {}] }],
    },
  } })
  try {
    let terminal: unknown
    for await (const event of run) {
      if (event.type === "result") { terminal = event; break }
    }
    expect(terminal).toMatchObject({ type: "result", is_error: false })
    expect(requests[0]?.tools?.map((tool) => tool.name)).toEqual(expect.arrayContaining(["Read", "TaskCreate", "TaskList"]))
    expect(replacements).toBe(3)
    expect.soft(JSON.stringify(requests[1]?.messages)).toContain("delivered-read-canary")
    expect.soft(JSON.stringify(requests[1]?.messages)).not.toContain("original-read-canary")
    expect(JSON.stringify(requests[2]?.messages)).toContain("delivered-bash-canary")
    const bashResult = requests[2]?.messages.flatMap((message) => {
      const content = (message as { content?: unknown }).content
      return Array.isArray(content) ? content : []
    }).find((block) => block?.type === "tool_result" && block.tool_use_id === "tool_2")
    expect(JSON.stringify(bashResult)).not.toContain("original-bash-canary")
    expect(JSON.stringify(requests[3]?.messages)).toContain("delivered-mcp-canary")
    expect(JSON.stringify(requests[3]?.messages)).not.toContain("original-mcp-canary")
    expect(batches).toContainEqual(["Read"])
    expect(stops).toBe(2)
    expect(snapshots).toHaveLength(5)
    expect(requestBytes).toBeGreaterThan(0)
    expect(JSON.stringify(requests[5]?.messages)).toContain("Retain this task")
    run.close()
    for (let generation = 0; generation < 21; generation += 1) {
      const firstRequest = requests.length
      tools.length = firstRequest
      tools.push({ name: "TaskList", input: {} })
      const isolated = generation === 20
      const next = query({ prompt: "List existing fixture tasks", options: {
        cwd: root, env: { ...env, CLAUDE_CODE_TASK_LIST_ID: isolated ? randomUUID() : taskListId },
        settingSources: [], strictMcpConfig: true, mcpServers: {}, model: "fixture-model", tools: ["TaskList"], maxTurns: 3,
        permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true,
      } })
      try {
        for await (const event of next) {
          if (event.type === "result") { expect(event.is_error).toBe(false); break }
        }
        const visible = JSON.stringify(requests[firstRequest + 1]?.messages)
        if (isolated) expect(visible).toContain("No tasks found")
        else expect(visible).toContain("Retain this task")
      } finally {
        next.close()
      }
    }
  } finally {
    run.close()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await rm(root, { recursive: true, force: true })
  }
}, 45_000)

// The installed SDK answers file-mutation tools with a structured payload that
// embeds the whole file, while the model only receives a short confirmation.
// Synapse must not treat that payload as model-visible content: the guard skips
// it (see tool-output-governor) and the request body must stay free of the file.
it("keeps native file-mutation payloads out of the next model request", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-sdk-mutation-"))
  const editedPath = path.join(root, "page.html")
  const writtenPath = path.join(root, "written.html")
  const notebookPath = path.join(root, "notes.ipynb")
  const filler = "filler-line\n".repeat(5_000)
  await writeFile(editedPath, `<!doctype html>\n<div>UNIQUE-EDIT-MARKER</div>\n${filler}`)
  await writeFile(notebookPath, JSON.stringify({
    cells: [{ cell_type: "code", execution_count: null, id: "cell-1", metadata: {}, outputs: [], source: ["print(0)\n"] }],
    metadata: {}, nbformat: 4, nbformat_minor: 5,
  }, null, 1))
  const requests: FixtureRequest[] = []
  const steps = [
    { name: "Read", input: { file_path: editedPath } },
    { name: "Edit", input: { file_path: editedPath, old_string: "UNIQUE-EDIT-MARKER", new_string: "UNIQUE-EDIT-MARKER-v2" } },
    { name: "Write", input: { file_path: writtenPath, content: `<!doctype html>\n${"written-line\n".repeat(3_000)}` } },
    { name: "Read", input: { file_path: notebookPath } },
    { name: "NotebookEdit", input: { notebook_path: notebookPath, cell_id: "cell-1", new_source: "print(1)", cell_type: "code", edit_mode: "replace" } },
  ]
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks)
    if (!req.url?.startsWith("/v1/messages")) {
      res.writeHead(404).end()
      return
    }
    if (req.url.includes("count_tokens")) {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ input_tokens: 1000 }))
      return
    }
    requests.push(JSON.parse(body.toString()) as FixtureRequest)
    const step = steps[requests.length - 1]
    res.writeHead(200, { "Content-Type": "text/event-stream" })
    const emit = (type: string, data: Record<string, unknown>) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
    emit("message_start", { message: { id: `msg_${requests.length}`, type: "message", role: "assistant", model: "fixture-model", content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 0 } } })
    emit("content_block_start", { index: 0, content_block: step
      ? { type: "tool_use", id: `tool_${requests.length}`, name: step.name, input: {} }
      : { type: "text", text: "" } })
    emit("content_block_delta", { index: 0, delta: step
      ? { type: "input_json_delta", partial_json: JSON.stringify(step.input) }
      : { type: "text_delta", text: "Fixture complete" } })
    emit("content_block_stop", { index: 0 })
    emit("message_delta", { delta: { stop_reason: step ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } })
    emit("message_stop", {})
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Loopback fixture did not start")
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    CLAUDE_CONFIG_DIR: path.join(root, "config"),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
    ANTHROPIC_API_KEY: "fixture-key",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  }
  const mutationTools = ["Edit", "Write", "NotebookEdit"]
  const hookPayloads: Array<{ toolName: string, bytes: number, payload: unknown }> = []
  const delivered: Array<{ toolName: string, bytes: number }> = []
  const run = query({ prompt: "Run the local file-mutation fixture", options: {
    cwd: root, env, settingSources: [], strictMcpConfig: true, mcpServers: {},
    model: "fixture-model", tools: ["Read", "Edit", "Write", "NotebookEdit"], maxTurns: 8,
    permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true,
    hooks: {
      PostToolUse: [{ matcher: "*", hooks: [async (input) => {
        if (input.hook_event_name !== "PostToolUse") return {}
        if (mutationTools.includes(input.tool_name)) {
          hookPayloads.push({ toolName: input.tool_name,
            bytes: Buffer.byteLength(JSON.stringify(input.tool_response) ?? "", "utf8"), payload: input.tool_response })
        }
        return {}
      }] }],
      PostToolBatch: [{ hooks: [async (input) => {
        if (input.hook_event_name !== "PostToolBatch") return {}
        for (const call of input.tool_calls) {
          if (!mutationTools.includes(call.tool_name)) continue
          delivered.push({ toolName: call.tool_name,
            bytes: Buffer.byteLength(JSON.stringify(call.tool_response) ?? "", "utf8") })
        }
        return {}
      }] }],
    },
  } })
  try {
    for await (const event of run) {
      if (event.type === "result") {
        expect(event.is_error).toBe(false)
        break
      }
    }
    const editPayload = hookPayloads.find((entry) => entry.toolName === "Edit")
    expect(editPayload?.bytes).toBeGreaterThan(Buffer.byteLength(filler, "utf8"))
    expect((editPayload?.payload as { originalFile?: string } | undefined)?.originalFile).toContain("filler-line")
    expect((hookPayloads.find((entry) => entry.toolName === "Write")?.payload as { content?: string } | undefined)?.content)
      .toContain("written-line")
    expect((hookPayloads.find((entry) => entry.toolName === "NotebookEdit")?.payload as { original_file?: string } | undefined)?.original_file)
      .toContain("print(0)")
    expect(delivered.map((entry) => entry.toolName)).toEqual(mutationTools)
    for (const entry of delivered) expect(entry.bytes).toBeLessThan(1_024)

    const readRequestBytes = Buffer.byteLength(JSON.stringify(requests[1]?.messages), "utf8")
    const editRequestBytes = Buffer.byteLength(JSON.stringify(requests[2]?.messages), "utf8")
    expect(editRequestBytes - readRequestBytes).toBeLessThan(4_096)

    const editResult = JSON.stringify(toolResultBlock(requests[2], "tool_2"))
    expect(editResult).toContain("has been updated successfully")
    expect(editResult).not.toContain("filler-line")
    const writeResult = JSON.stringify(toolResultBlock(requests[3], "tool_3"))
    expect(writeResult).toContain("created successfully")
    expect(writeResult).not.toContain("written-line")
    const notebookResult = JSON.stringify(toolResultBlock(requests[5], "tool_5"))
    expect(notebookResult).toContain("Updated cell cell-1")
    expect(notebookResult).not.toContain("print(0)")
  } finally {
    run.close()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await rm(root, { recursive: true, force: true })
  }
}, 45_000)
