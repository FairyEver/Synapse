import { createRequire } from "node:module"
import path from "node:path"
import fs from "node:fs/promises"
import { expect, it, vi } from "vitest"
import { appendGeneratedUiPrompt } from "../../electron/services/agent-runtime/generated-ui-prompt"
import { splitGeneratedUiContent, validateGeneratedUiSource } from "../../src/lib/agent-generated-ui"
import { GeneratedUiView } from "../../src/modules/agent/openui/generated-ui-view"
import { GeneratedUiTheme } from "../../src/modules/agent/openui/generated-ui-theme"

vi.mock("@/lib/electron-bridge", () => ({ requireBridgeDomain: () => ({}) }))
vi.mock("@/app-shell/logging", () => ({ createRendererLogger: () => ({ warn: vi.fn() }) }))
vi.mock("@/lib/ui-tracking", () => ({ track: vi.fn() }))

// Read-only synthetic aggregates, not a live Gitee query or personnel evaluation.
const fixture = {
  scope: "2026-10-29 00:00–16:26 +08:00, created today, all states",
  total: 79, resolved: 48, unresolved: 21, rejected: 10,
  fixMinutes: { samples: 48, average: 74, median: 52 },
  projects: [{ name: "项目甲", total: 52, resolved: 30, unresolved: 12, rejected: 10 }, { name: "项目乙", total: 12, resolved: 7, unresolved: 5, rejected: 0 }, { name: "其他项目", total: 15, resolved: 11, unresolved: 4, rejected: 0 }],
  people: [{ name: "人员甲", total: 18, resolved: 7, unresolved: 11, rejected: 0 }, { name: "人员乙", total: 17, resolved: 6, unresolved: 5, rejected: 6 }, { name: "其他人员", total: 44, resolved: 35, unresolved: 5, rejected: 4 }],
  environments: [{ name: "生产监控", total: 52, resolved: 30, unresolved: 12, rejected: 10 }, { name: "测试", total: 13, resolved: 8, unresolved: 5, rejected: 0 }, { name: "其他", total: 14, resolved: 10, unresolved: 4, rejected: 0 }],
}
const report = "看看今天gitee上创建的问题，包括已经解决的和没有解决的，从人员，环境，项目，修复状态，修复速度等多个方面，形成分析报告"
const scenarios = [
  { id: "host-report", prompt: report, host: true, skill: false, ui: true },
  { id: "skill-report", prompt: report, host: true, skill: true, ui: true },
  { id: "text-only", prompt: report + "。只要纯文字，不要图表或交互界面。", host: true, skill: true, ui: false },
  { id: "count-only", prompt: "今天创建的问题一共多少条？只回答一个数量。", host: true, skill: true, ui: false },
  { id: "unsupported-host", prompt: report, host: false, skill: true, ui: false },
]
const mode = process.env.SYNAPSE_OPENUI_REPORT_MODE ?? "candidate"
const repetitions = Number(process.env.SYNAPSE_OPENUI_REPORT_REPS ?? 1)
const rootDirectory = path.resolve(process.cwd(), "..")
const evidenceRoot = path.join(rootDirectory, "work/openui-report-audit")
const referencePath = path.join(rootDirectory, "desktop/resources/agent-openui-reference.md")

for (const scenario of scenarios) for (let sample = 1; sample <= (scenario.ui ? repetitions : 1); sample++) {
  it(`${mode}: ${scenario.id} sample ${sample}`, async () => {
    const require = createRequire(path.join(rootDirectory, "desktop/package.json"))
    const { query } = await import(require.resolve("@anthropic-ai/claude-agent-sdk"))
    const settings = JSON.parse(await fs.readFile(path.join(process.env.HOME, ".claude/settings.json"), "utf8"))
    const providerEnv = Object.fromEntries(Object.entries(settings.env ?? {}).filter(([key]) => key.startsWith("ANTHROPIC_")))
    const baseline = mode === "baseline" ? JSON.parse(await fs.readFile(path.join(evidenceRoot, "baseline.json"), "utf8")) : undefined
    const skill = baseline?.skill ?? await fs.readFile(path.join(rootDirectory, "desktop/app-capabilities/synapse-skill/skill-package/SKILL.md"), "utf8")
    const system = [
      "默认只给文字回复；只有用户明确要求 HTML、网页报告时才生成页面。",
      scenario.host ? baseline?.prompt ?? appendGeneratedUiPrompt(undefined, referencePath).append : "This host does not provide OpenUI.",
      scenario.skill ? skill : "",
    ].join("\n\n")
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 150_000)
    const evidence = { mode, scenario: scenario.id, sample, model: "deepseek-flash[1M]", text: "", tools: [], success: false, rendered: false }
    const session = query({ prompt: scenario.prompt + "\n\n以下为已经获取的只读测试夹具，不要访问实际 Gitee、MCP 或创建文件。报告仅依据这些数据，不猜测其他明细：\n" + JSON.stringify(fixture), options: {
      cwd: rootDirectory, model: evidence.model, systemPrompt: system, tools: ["Read"], settingSources: [], strictMcpConfig: true, mcpServers: {},
      env: providerEnv, settings: { env: providerEnv, disableAllHooks: true }, abortController: abort,
      canUseTool: async (name, args) => ({ behavior: name === "Read" && [referencePath, path.join(evidenceRoot, "baseline-reference.md")].includes(args.file_path) ? "allow" : "deny", message: "Only the host OpenUI reference is available in this fixture." }),
    } })
    try {
      for await (const message of session) {
        if (message.type === "assistant") for (const block of message.message.content) {
          if (block.type === "text") evidence.text += block.text + "\n"
          if (block.type === "tool_use") evidence.tools.push({ name: block.name, path: block.input.file_path })
        }
        if (message.type === "result") { evidence.success = message.subtype === "success" && !message.is_error; evidence.usage = message.usage }
      }
      expect(evidence.success).toBe(true)
      const parts = splitGeneratedUiContent(evidence.text).filter(part => part.kind === "openui")
      evidence.blocks = parts.length
      // Baseline records decisions without forcing the old prompt to pass acceptance.
      if (mode !== "baseline") {
        expect(parts.length > 0).toBe(scenario.ui)
        expect(evidence.text).toContain("79")
        if (scenario.ui) expect(evidence.tools.some(tool => tool.name === "Read" && tool.path === referencePath)).toBe(true)
        else expect(evidence.tools).toHaveLength(0)
      }
      for (const part of parts) expect(validateGeneratedUiSource(part.content)).toBeNull()
      if (parts.length) {
        const React = require("react"), { act } = React, { createRoot } = require("react-dom/client")
        globalThis.IS_REACT_ACT_ENVIRONMENT = true
        vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
        vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ font: "", measureText: value => ({ width: value.length * 7 }) })
        const host = document.createElement("div"); document.body.append(host); const root = createRoot(host)
        try {
          await act(async () => root.render(React.createElement(GeneratedUiTheme, null, ...parts.map(part => React.createElement(GeneratedUiView, { key: part.ordinal, source: part.content, streaming: false, disabled: true })))))
          expect(host.querySelector("[data-agent-render-error]")).toBeNull()
          expect(host.textContent.trim().length).toBeGreaterThan(0)
          evidence.rendered = true
        } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks() }
      }
    } finally {
      clearTimeout(timer); session.close()
      await fs.mkdir(evidenceRoot, { recursive: true })
      await fs.writeFile(path.join(evidenceRoot, `${mode}-${scenario.id}-${sample}.json`), JSON.stringify(evidence, null, 2))
    }
  })
}
