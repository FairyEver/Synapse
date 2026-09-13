import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { query, type Options, type Query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk"

/** Minimal OS launch environment; test homes never fall back to the user's SDK profile. */
export function nativeFixtureEnvironment(root: string): NodeJS.ProcessEnv {
  const allowed = new Set(["path", "systemroot", "windir", "comspec", "pathext", "claude_code_git_bash_path"])
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase()))),
    HOME: root, USERPROFILE: root, TMP: root, TEMP: root, TMPDIR: root,
    CLAUDE_CONFIG_DIR: path.join(root, "config"),
  }
}

export interface FixtureCall { name: string; input: Record<string, unknown>; id: string }
export interface FixtureRequest { stream?: boolean; messages: Array<{ content?: unknown }>; tools?: Array<{ name: string }> }
export type FixtureReply = string | readonly FixtureCall[]

/** Installed native SDK; all model responses are scripted on loopback with isolated settings. */
export async function createNativeSdkFixture(reply: (request: FixtureRequest, index: number) => FixtureReply) {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-native-protocol-"))
  const requests: FixtureRequest[] = []
  const requestBytes: number[] = []
  const runs: Query[] = []
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      if (!req.url?.startsWith("/v1/messages")) { res.writeHead(404).end(); return }
      if (req.url.includes("count_tokens")) {
        res.writeHead(200, { "Content-Type": "application/json" }).end('{"input_tokens":1000}')
        return
      }
      const body = Buffer.concat(chunks)
      const request = JSON.parse(body.toString()) as FixtureRequest
      const response = reply(request, requests.length)
      requests.push(request)
      requestBytes.push(body.byteLength)
      if (request.stream === false) {
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
          id: `msg_${requests.length}`, type: "message", role: "assistant", model: "fixture-model",
          content: typeof response === "string" ? [{ type: "text", text: response }]
            : response.map((call) => ({ type: "tool_use", ...call })),
          stop_reason: typeof response === "string" ? "end_turn" : "tool_use",
          stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 20 },
        }))
        return
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" })
      const emit = (type: string, data: Record<string, unknown>) =>
        res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
      emit("message_start", { message: { id: `msg_${requests.length}`, type: "message", role: "assistant",
        model: "fixture-model", content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 1000, output_tokens: 0 } } })
      const blocks = typeof response === "string" ? [response] : response
      blocks.forEach((block, index) => {
        emit("content_block_start", { index, content_block: typeof block === "string"
          ? { type: "text", text: "" } : { type: "tool_use", id: block.id, name: block.name, input: {} } })
        emit("content_block_delta", { index, delta: typeof block === "string"
          ? { type: "text_delta", text: block } : { type: "input_json_delta", partial_json: JSON.stringify(block.input) } })
        emit("content_block_stop", { index })
      })
      emit("message_delta", { delta: { stop_reason: typeof response === "string" ? "end_turn" : "tool_use", stop_sequence: null },
        usage: { output_tokens: 20 } })
      emit("message_stop", {})
      res.end()
    } catch (error) {
      res.destroy(error instanceof Error ? error : new Error(String(error)))
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing loopback address")
  const env = {
    ...nativeFixtureEnvironment(root),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`, ANTHROPIC_API_KEY: "fixture-key",
    CLAUDE_CODE_TASK_LIST_ID: randomUUID(), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  }
  return {
    root, requests, requestBytes, env,
    start(options: Partial<Options> = {}, prompt = "Execute scripted protocol") {
      const run = query({ prompt, options: {
        cwd: root, settingSources: [], strictMcpConfig: true, mcpServers: {}, model: "fixture-model", maxTurns: 16,
        permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true, ...options,
        env: { ...env, ...options.env }, settings: { env: {
          ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
          CLAUDE_CODE_TASK_LIST_ID: env.CLAUDE_CODE_TASK_LIST_ID,
        } },
      } })
      runs.push(run)
      return run
    },
    async close() {
      for (const run of runs) run.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    },
  }
}

export async function collectNativeResult(run: Query): Promise<SDKMessage & { type: "result" }> {
  for await (const event of run) if (event.type === "result") return event
  throw new Error("Native SDK ended without result")
}

export function toolResult(request: FixtureRequest | undefined, id: string): unknown {
  return request?.messages.flatMap((message) => Array.isArray(message.content) ? message.content : [])
    .find((block) => block.type === "tool_result" && block.tool_use_id === id)
}
