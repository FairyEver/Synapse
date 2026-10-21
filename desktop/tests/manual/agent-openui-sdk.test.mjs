import { createRequire } from "node:module"
import path from "node:path"
import { expect, it, vi } from "vitest"
import { GeneratedUiView } from "../../src/modules/agent/openui/generated-ui-view"
import { GeneratedUiTheme } from "../../src/modules/agent/openui/generated-ui-theme"
import { GeneratedUiService, createGeneratedUiMetadata } from "../../electron/services/agent-runtime/generated-ui-service"
import { appendGeneratedUiPrompt } from "../../electron/services/agent-runtime/generated-ui-prompt"
import { splitGeneratedUiContent, validateGeneratedUiSource } from "../../src/lib/agent-generated-ui"

const bridge = vi.hoisted(() => ({ getGeneratedUiState: vi.fn(), saveGeneratedUiState: vi.fn(), submitGeneratedUiAction: vi.fn() }))
vi.mock("@/lib/electron-bridge", () => ({ requireBridgeDomain: () => bridge }))
vi.mock("@/app-shell/logging", () => ({ createRendererLogger: () => ({ warn: vi.fn() }) }))
vi.mock("@/lib/ui-tracking", () => ({ track: vi.fn() }))

it("real Claude query -> official chart and editable form -> same query -> remounted state", async () => {
  const rootDirectory = path.resolve(process.cwd(), "..")
  const require = createRequire(path.join(rootDirectory, "desktop/package.json"))
  const React = require("react")
  const { act } = React
  const { createRoot } = require("react-dom/client")
  const sdk = await import(require.resolve("@anthropic-ai/claude-agent-sdk"))
  const { z } = require("zod")
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ font: "", measureText: (s) => ({ width: s.length * 7 }) })
  const queue = []
  let wake
  let ended = false
  const push = (content) => { queue.push({ type: "user", session_id: "", parent_tool_use_id: null, message: { role: "user", content } }); wake?.(); wake = undefined }
  async function* input() { while (!ended) { if (!queue.length) await new Promise((resolve) => { wake = resolve }); while (queue.length) yield queue.shift() } }
  function ns() { const rows = new Map(); return { get: async (id) => rows.get(id) ?? null, upsert: async (row) => { rows.set(row.id, structuredClone(row)) }, remove: async (id) => rows.delete(id), list: async (filter = {}) => [...rows.values()].filter((row) => Object.entries(filter).every(([k, v]) => row[k] === v)) } }
  let calls = 0
  const days = []
  const server = sdk.createSdkMcpServer({ name: "openui-smoke", version: "1.0.0", tools: [sdk.tool("get_report", "Read fixture trend report", { days: z.coerce.number() }, async (args) => { calls++; days.push(args.days); return { content: [{ type: "text", text: JSON.stringify({ days: args.days, labels: ["周一", "周二", "周三"], values: [10, 14, 12].map((v) => v * args.days) }) }] } })] })
  const abort = new AbortController()
  const query = sdk.query({ prompt: input(), options: { cwd: rootDirectory, systemPrompt: appendGeneratedUiPrompt(undefined), tools: [], settingSources: ["user"], strictMcpConfig: true, mcpServers: { "openui-smoke": server }, allowedTools: ["mcp__openui-smoke__get_report"], abortController: abort } })
  const outputs = []
  const waiters = []
  const sessions = new Set()
  const nextTurn = () => outputs.length ? Promise.resolve(outputs.shift()) : new Promise((resolve) => waiters.push(resolve))
  const reader = (async () => { let content = ""; try { for await (const message of query) {
    if (message.session_id) sessions.add(message.session_id)
    if (message.type === "assistant") { const text = message.message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n"); if (text.includes("```openui")) content = text }
    if (message.type === "result") { const result = { content, success: message.subtype === "success" && !message.is_error }; const waiter = waiters.shift(); if (waiter) waiter(result); else outputs.push(result); content = "" }
  } } catch (error) { const waiter = waiters.shift(); if (waiter) waiter({ success: false, error: error.name }) } })()
  const conversations = ns(); const states = ns()
  let service = new GeneratedUiService("smoke-project", conversations, states)
  bridge.getGeneratedUiState.mockImplementation((target) => service.get(target))
  bridge.saveGeneratedUiState.mockImplementation((target) => service.save(target))
  bridge.submitGeneratedUiAction.mockImplementation((target) => service.submit(target, async (submission) => { push(submission.content); return true }))
  const host = document.createElement("div"); document.body.append(host); let root = createRoot(host)
  const timer = setTimeout(() => abort.abort(), 150_000)
  try {
    push('只读集成验收：调用 get_report 获取7天数据。仅返回一个 openui 围栏，root = Stack，包含 LineChart 和 Form，表单 name="filters"，Input name="days" type="number" 默认"7"，按钮标签固定为"更新"，action=@ToAssistant("按提交天数重新查询并更新图表")。不要创建文件。使用组件顺序 Form("filters", Buttons([Button("更新", @ToAssistant("按提交天数重新查询并更新图表"))]), [FormControl("天数", Input("days", null, "number", null, "7"))])，图表使用实际工具数据。')
    const first = await nextTurn(); expect(first.success).toBe(true)
    const parts = splitGeneratedUiContent(first.content).filter((part) => part.kind === "openui")
    expect(parts.length).toBeGreaterThan(0)
    for (const part of parts) expect(validateGeneratedUiSource(part.content)).toBeNull()
    const metadata = createGeneratedUiMetadata(first.content, "smoke-turn")
    await conversations.upsert({ id: "smoke-conversation", projectId: "smoke-project", platform: "local-renderer", sessionKey: "smoke", history: [{ role: "assistant", content: first.content, metadata: { generatedUi: metadata } }] })
    const render = () => React.createElement(GeneratedUiTheme, null, ...parts.map((part) => React.createElement(GeneratedUiView, { key: part.ordinal, source: part.content, streaming: false, block: metadata.blocks.find((b) => b.ordinal === part.ordinal), projectId: "smoke-project", conversationId: "smoke-conversation" })))
    await act(async () => root.render(render()))
    expect(host.querySelector('[class*="chart"]')).not.toBeNull()
    const field = host.querySelector('input[name="days"]')
    expect(field).not.toBeNull()
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, "30"); field.dispatchEvent(new Event("input", { bubbles: true })) })
    expect(field.value).toBe("30")
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "更新")
    expect(button).toBeDefined()
    await act(async () => button.click())
    expect(bridge.submitGeneratedUiAction).toHaveBeenCalledTimes(1)
    const second = await nextTurn(); expect(second.success).toBe(true)
    const nextParts = splitGeneratedUiContent(second.content).filter((part) => part.kind === "openui")
    expect(nextParts.length).toBeGreaterThan(0)
    for (const part of nextParts) expect(validateGeneratedUiSource(part.content)).toBeNull()
    expect(days).toEqual([7, 30]); expect(sessions.size).toBe(1)
    await act(async () => root.unmount())
    service = new GeneratedUiService("smoke-project", conversations, states)
    root = createRoot(host)
    await act(async () => root.render(render()))
    expect(host.querySelector('input[name="days"]').value).toBe("30")
    process.stdout.write(JSON.stringify({ sdkTurns: 2, toolCalls: calls, sameSession: true, renderedChart: true, officialFormSubmitted: true, restoredAfterRemount: true }) + "\n")
  } finally { clearTimeout(timer); ended = true; wake?.(); query.close(); await reader; await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks() }
})
