import { createRequire } from "node:module"
import path from "node:path"
import fs from "node:fs/promises"
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

const scenarios = [
  { id: "trend", prompt: "读取夹具7天趋势报告，在聊天里画可交互折线图，并提供天数输入框（默认7）和更新按钮；填写30并点击后，应重新读取数据并更新整张图。不要创建文件。" },
  { id: "table", prompt: "读取夹具7天报告。在聊天里给我一张每天数值的交互表格，并附一个天数输入框（默认7）和更新按钮；点击更新时重新读取报告，表格和汇总一起更新。不要创建文件。" },
  { id: "form", prompt: "在聊天里做一个可提交的报告查询表单：数字天数输入框默认7、更新按钮，再用折线图展示读取夹具7天得到的数据。表单提交后按输入天数重新读取报告、重新展示表单和图表。不要创建文件。" },
]
const mode = process.env.SYNAPSE_OPENUI_COMPARISON_MODE ?? "baseline"
const liveIt = process.env.SYNAPSE_OPENUI_REPLAY_ONLY === "1" ? it.skip : it
for (const scenario of scenarios) liveIt(`${mode}: ${scenario.id} -> real form submission -> same-session result`, async () => {
  vi.clearAllMocks()
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
  const referencePath = path.join(rootDirectory, "desktop/resources/agent-openui-reference.md")
  const evidence = { mode, scenario: scenario.id, prompt: scenario.prompt, outputs: [], toolCalls: [], referenceReads: 0, usage: [], checks: {} }
  const settings = { disableAllHooks: true }
  const options = { cwd: path.join(process.env.HOME, "Library/Application Support/Synapse/agent-workspaces/default"), systemPrompt: appendGeneratedUiPrompt(undefined, mode === "candidate" ? referencePath : undefined), tools: ["Read"], settingSources: ["user"], skills: "all", settings, strictMcpConfig: true, mcpServers: { "openui-smoke": server }, allowedTools: ["mcp__openui-smoke__get_report"], canUseTool: async (name, args) => {
    if (name === "Read" && args.file_path === referencePath) { evidence.referenceReads++; return { behavior: "allow", updatedInput: args } }
    return { behavior: "deny", message: "This fixture permits only reading the OpenUI reference and get_report." }
  }, abortController: abort }
  const query = sdk.query({ prompt: input(), options })
  const outputs = []
  const waiters = []
  const sessions = new Set()
  const nextTurn = () => outputs.length ? Promise.resolve(outputs.shift()) : new Promise((resolve) => waiters.push(resolve))
  const reader = (async () => { let content = ""; try { for await (const message of query) {
    if (message.session_id) sessions.add(message.session_id)
    if (message.type === "assistant") { for (const block of message.message.content) if(block.type === "tool_use") evidence.toolCalls.push({ name: block.name, input: block.input }); const text = message.message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n"); if (text.includes("```openui")) content = text }
    if (message.type === "result") { evidence.usage.push(message.usage); const result = { content, success: message.subtype === "success" && !message.is_error }; const waiter = waiters.shift(); if (waiter) waiter(result); else outputs.push(result); content = "" }
  } } catch (error) { const waiter = waiters.shift(); if (waiter) waiter({ success: false, error: error.name }) } })()
  const conversations = ns(); const states = ns()
  let service = new GeneratedUiService("smoke-project", conversations, states)
  bridge.getGeneratedUiState.mockImplementation((target) => service.get(target))
  bridge.saveGeneratedUiState.mockImplementation((target) => service.save(target))
  bridge.submitGeneratedUiAction.mockImplementation((target) => service.submit(target, async (submission) => { push(submission.content); return true }))
  const host = document.createElement("div"); document.body.append(host); let root = createRoot(host)
  const timer = setTimeout(() => abort.abort(), 260_000)
  try {
    push(scenario.prompt)
    const first = await nextTurn(); evidence.outputs.push(first); expect(first.success).toBe(true)
    if(mode === "candidate") expect(evidence.toolCalls.some(call => call.name === "Read" && call.input.file_path === referencePath)).toBe(true)
    let parts = splitGeneratedUiContent(first.content).filter((part) => part.kind === "openui")
    expect(parts.length).toBeGreaterThan(0)
    for (const part of parts) expect(validateGeneratedUiSource(part.content)).toBeNull()
    let metadata = createGeneratedUiMetadata(first.content, "smoke-turn")
    await conversations.upsert({ id: "smoke-conversation", projectId: "smoke-project", platform: "local-renderer", sessionKey: "smoke", history: [{ role: "assistant", content: first.content, metadata: { generatedUi: metadata } }] })
    const render = () => React.createElement(GeneratedUiTheme, null, ...parts.map((part) => React.createElement(GeneratedUiView, { key: part.ordinal, source: part.content, streaming: false, block: metadata.blocks.find((b) => b.ordinal === part.ordinal), projectId: "smoke-project", conversationId: "smoke-conversation" })))
    await act(async () => root.render(render()))
    if (scenario.id === "table") expect(host.querySelector("table")).not.toBeNull()
    else expect(host.querySelector('[class*="chart"]')).not.toBeNull()
    evidence.checks.firstRendered = true
    const field = host.querySelector('input[type="number"]')
    expect(field).not.toBeNull()
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, "30"); field.dispatchEvent(new Event("input", { bubbles: true })) })
    expect(field.value).toBe("30")
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith("更新"))
    expect(button).toBeDefined()
    await act(async () => button.click())
    expect(bridge.submitGeneratedUiAction).toHaveBeenCalledTimes(1)
    const second = await nextTurn(); evidence.outputs.push(second); expect(second.success).toBe(true)
    const nextParts = splitGeneratedUiContent(second.content).filter((part) => part.kind === "openui")
    expect(nextParts.length).toBeGreaterThan(0)
    for (const part of nextParts) expect(validateGeneratedUiSource(part.content)).toBeNull()
    const prior = await conversations.get("smoke-conversation")
    parts = nextParts
    metadata = createGeneratedUiMetadata(second.content, "smoke-turn-2")
    await conversations.upsert({ ...prior, history: [...prior.history, { role: "assistant", content: second.content, metadata: { generatedUi: metadata } }] })
    await act(async () => root.render(render()))
    expect(host.querySelector('input[type="number"]').value).toBe("30")
    if (scenario.id === "table") expect(host.querySelector("table")).not.toBeNull()
    else expect(host.querySelector('[class*="chart"]')).not.toBeNull()
    evidence.checks.secondRendered = true
    expect(days[0]).toBe(7); expect(days.slice(1)).toContain(30); expect([...new Set(days)]).toEqual([7, 30]); expect(sessions.size).toBe(1)
    await act(async () => root.unmount())
    service = new GeneratedUiService("smoke-project", conversations, states)
    root = createRoot(host)
    await act(async () => root.render(render()))
    expect(host.querySelector('input[type="number"]').value).toBe("30")
    evidence.checks = { ...evidence.checks, sdkTurns: 2, fixtureCalls: calls, requestedDays: days, sameSession: sessions.size === 1, officialFormSubmitted: true, restoredAfterRemount: true }
    process.stdout.write(JSON.stringify({ mode, scenario: scenario.id, ...evidence.checks, referenceReads: evidence.referenceReads }) + "\n")
  } finally { await fs.mkdir(path.join(rootDirectory, "work/agent-context-audit/comparison"), { recursive: true }); await fs.writeFile(path.join(rootDirectory, `work/agent-context-audit/comparison/${mode}-${scenario.id}-${Date.now()}.json`), JSON.stringify(evidence, null, 2)); clearTimeout(timer); ended = true; wake?.(); query.close(); await reader; await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks() }
})

for (const scenario of [{ id: "hi", prompt: "hi" }, { id: "code", prompt: "给我一个 React Counter 组件的代码示例，只给代码，不要创建文件。" }]) liveIt(`${mode}: ${scenario.id} stays ordinary text/code`, async () => {
  const rootDirectory = path.resolve(process.cwd(), "..")
  const require = createRequire(path.join(rootDirectory, "desktop/package.json"))
  const sdk = await import(require.resolve("@anthropic-ai/claude-agent-sdk"))
  const referencePath = path.join(rootDirectory, "desktop/resources/agent-openui-reference.md")
  const evidence = { mode, scenario: scenario.id, prompt: scenario.prompt, outputs: [], toolCalls: [], referenceReads: 0, usage: [] }
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 120_000)
  const query = sdk.query({ prompt: scenario.prompt, options: { cwd: path.join(process.env.HOME, "Library/Application Support/Synapse/agent-workspaces/default"), systemPrompt: appendGeneratedUiPrompt(undefined, mode === "candidate" ? referencePath : undefined), tools: ["Read"], settingSources: ["user"], skills: "all", settings: { disableAllHooks: true }, strictMcpConfig: true, mcpServers: {}, abortController: abort, canUseTool: async () => ({ behavior: "deny", message: "No file reads needed for this text/code example." }) } })
  try {
    for await (const m of query) {
      if(m.type === "assistant") for (const b of m.message.content) { if(b.type === "text") evidence.outputs.push(b.text); if(b.type === "tool_use") evidence.toolCalls.push({ name: b.name }) }
      if(m.type === "result") { evidence.usage.push(m.usage); expect(m.is_error).not.toBe(true) }
    }
    const text = evidence.outputs.join("\n")
    expect(text.length).toBeGreaterThan(0)
    expect(splitGeneratedUiContent(text).filter(p => p.kind === "openui")).toHaveLength(0)
    expect(evidence.toolCalls).toHaveLength(0)
    if(scenario.id === "code") expect(text).toContain("useState")
  } finally { clearTimeout(timer); query.close(); await fs.mkdir(path.join(rootDirectory,"work/agent-context-audit/comparison"), {recursive:true}); await fs.writeFile(path.join(rootDirectory,`work/agent-context-audit/comparison/${mode}-${scenario.id}-${Date.now()}.json`),JSON.stringify(evidence,null,2)) }
})

const replayRoot = path.resolve(process.cwd(), "../work/agent-context-audit/comparison")
const replayFiles = (await fs.readdir(replayRoot).catch(error => { if(error.code === "ENOENT") return []; throw error })).filter(name => /^(baseline|candidate)-(trend|table|form)-.*\.json$/.test(name))
for (const file of replayFiles) {
  const evidence = JSON.parse(await fs.readFile(path.join(replayRoot, file), "utf8"))
  if (evidence.outputs.length !== 2 || evidence.checks?.sdkTurns !== 2) continue
  it(`offline replay both real outputs: ${file}`, async () => {
    vi.clearAllMocks()
    const require = createRequire(path.resolve(process.cwd(), "package.json"))
    const React = require("react"), { act } = React, { createRoot } = require("react-dom/client")
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ font: "", measureText: s => ({ width:s.length*7 }) })
    const rows = new Map(), store = { get: async id => rows.get(id) ?? null, upsert: async row => rows.set(row.id, structuredClone(row)), remove: async id => rows.delete(id), list: async () => [...rows.values()] }
    const states = new Map(), stateStore = { ...store, get: async id => states.get(id) ?? null, upsert: async row => states.set(row.id, structuredClone(row)) }
    const service = new GeneratedUiService("replay-project", store, stateStore)
    bridge.getGeneratedUiState.mockImplementation(target => service.get(target))
    bridge.saveGeneratedUiState.mockImplementation(target => service.save(target))
    const host = document.createElement("div"); document.body.append(host); let root = createRoot(host)
    const history = []
    let render
    try {
      for (let turn = 0; turn < 2; turn++) {
        const content = evidence.outputs[turn].content, parts = splitGeneratedUiContent(content).filter(p => p.kind === "openui")
        expect(parts.length).toBeGreaterThan(0)
        for (const part of parts) expect(validateGeneratedUiSource(part.content)).toBeNull()
        const metadata = createGeneratedUiMetadata(content, `replay-turn-${turn}`)
        history.push({ role:"assistant", content, metadata:{generatedUi:metadata} })
        await store.upsert({ id:"replay-conversation", projectId:"replay-project", platform:"local-renderer", sessionKey:"replay", history })
        render = () => React.createElement(GeneratedUiTheme,null,...parts.map(part => React.createElement(GeneratedUiView,{ key: metadata.blocks[part.ordinal].id,source:part.content,streaming:false,block:metadata.blocks[part.ordinal],projectId:"replay-project",conversationId:"replay-conversation" })))
        await act(async () => root.render(render()))
        expect(host.querySelector('input[type="number"]').value).toBe(turn === 0 ? "7" : "30")
        if(evidence.scenario === "table") expect(host.querySelector("table")).not.toBeNull()
        else expect(host.querySelector('[class*="chart"]')).not.toBeNull()
        if(turn === 1) { expect(content).toContain("300"); expect(content).toContain("420") }
      }
      await act(async () => root.unmount()); root=createRoot(host)
      await act(async () => root.render(render()))
      expect(host.querySelector('input[type="number"]').value).toBe("30")
    } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks() }
  })
}

it.runIf(process.env.SYNAPSE_OPENUI_PRODUCTION_SMOKE === "1")("production session: hi retains native tools and rules", async () => {
  const { ClaudeSDKSession } = await import("../../electron/services/agent-runtime/claude-sdk-session")
  const { discoverStagingSkillOverrides } = await import("../../electron/services/agent-runtime/staging-skill-overrides")
  const home = process.env.HOME, rootDirectory = path.resolve(process.cwd(), "..")
  const settings = JSON.parse(await fs.readFile(path.join(home,".claude/settings.json"),"utf8"))
  const config = JSON.parse(await fs.readFile(path.join(home,".claude.json"),"utf8"))
  const cwd = path.join(home,"Library/Application Support/Synapse/agent-workspaces/default")
  const referencePath = path.join(rootDirectory,"desktop/resources/agent-openui-reference.md")
  const session = new ClaudeSDKSession({ projectId:"openui-production-smoke", conversationId:"openui-production-smoke", providerId:"deepseek", cwd, env:settings.env, mode:"default", systemPrompt:appendGeneratedUiPrompt(undefined,mode === "candidate" ? referencePath : undefined), generatedUiReferencePath:mode === "candidate" ? referencePath : undefined,
    sdkSettings:{ deniedMcpServers:Object.keys(config.mcpServers ?? {}).filter(name => name !== "synapse-mcp").map(serverName => ({serverName})), skillOverrides:mode === "candidate" ? await discoverStagingSkillOverrides(cwd) : {} },
    synapseToolRouter:{cwd,settingSources:["user","project","local"],executeTool:async () => {throw new Error("Fixture must not invoke business tools")}} })
  const evidence={tools:[],mcpServers:[],usage:null,toolCalls:[],reply:""}, timer=setTimeout(() => { void session.close() },120_000)
  try {
    await session.send({projectId:"openui-production-smoke",sessionKey:"openui-production-smoke",platform:"local-renderer",content:"hi"})
    for (;;) {
      const event = await session.nextEvent()
      if(!event) break
      if(event.type === "sessionInit") { evidence.tools=event.tools ?? []; evidence.mcpServers=event.mcpServers ?? [] }
      if(event.type === "toolUse") evidence.toolCalls.push(event.toolName)
      if(event.type === "assistant") evidence.reply=(event.message?.content ?? []).filter(block => block.type === "text").map(block => block.text).join("\n") || evidence.reply
      if(event.type === "result") { evidence.usage=event.usage; break }
      if(event.type === "error") throw new Error("Production smoke query returned an error")
    }
    expect(evidence.tools.length).toBeGreaterThan(20)
    expect(evidence.tools.filter(name => name.startsWith("mcp__") && !name.startsWith("mcp__synapse-tool-router__"))).toHaveLength(0)
    expect(evidence.mcpServers).toEqual([expect.objectContaining({name:"synapse-tool-router",status:"connected"})])
    expect(evidence.toolCalls).toHaveLength(0)
    expect(evidence.usage).not.toBeNull()
    expect(evidence.reply.length).toBeGreaterThan(0)
  } finally { clearTimeout(timer); await session.close(); await fs.writeFile(path.join(rootDirectory,`work/agent-context-audit/production-${mode}-hi.json`),JSON.stringify(evidence,null,2)) }
})
