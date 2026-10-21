// @vitest-environment jsdom
import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GeneratedUiView } from "../generated-ui-view"
import { GeneratedUiTheme } from "../generated-ui-theme"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openuidev/react-ui"
import { thirtyDayReportSource } from "@/lib/__tests__/fixtures/generated-ui-report"

const bridge = vi.hoisted(() => ({
  getGeneratedUiState: vi.fn(), saveGeneratedUiState: vi.fn(), submitGeneratedUiAction: vi.fn(),
}))
vi.mock("@/lib/electron-bridge", () => ({ requireBridgeDomain: (domain: string) => domain === "agent" ? bridge : { openExternal: vi.fn() } }))
vi.mock("@/app-shell/logging", () => ({ createRendererLogger: () => ({ warn: vi.fn() }) }))
const block = { id: "12345678-1234-4234-8234-123456789012", ordinal: 0, sourceHash: "a".repeat(64) }
let host: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  bridge.getGeneratedUiState.mockResolvedValue({ revision: 0, state: {}, readOnly: false })
  bridge.saveGeneratedUiState.mockResolvedValue({ revision: 1, state: {}, readOnly: false })
  bridge.submitGeneratedUiAction.mockResolvedValue({ submissionId: "test", status: "accepted" })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.documentElement.classList.remove("dark"); vi.clearAllMocks(); vi.restoreAllMocks() })

describe("GeneratedUiView", () => {
  it("renders the reported 30-day dashboard with shared data using official components", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ font: "", measureText: (text: string) => ({ width: text.length * 7 }) } as unknown as CanvasRenderingContext2D)
    await act(async () => root.render(<GeneratedUiTheme><GeneratedUiView source={thirtyDayReportSource} streaming={false} block={block} projectId="p" conversationId="c" /></GeneratedUiTheme>))
    expect(host.textContent).not.toMatch(/界面.*(?:无效|不支持|无法显示)/)
    expect(host.textContent).toContain("435")
    expect(host.querySelector("table")).not.toBeNull()
    expect(host.querySelector('[class*="chart"]')).not.toBeNull()
    expect(host.querySelector("[inert]")).toBeNull()
    vi.unstubAllGlobals()
  })
  it("renders the sales report and submits the filter despite the reported optional Stack parameter error", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ font: "", measureText: (text: string) => ({ width: text.length * 7 }) } as unknown as CanvasRenderingContext2D)
    const source = `root = Stack([filterForm, kpiRow, chart, table])
filterForm = Form("filter", Buttons([Button("更新结果", @ToAssistant("更新结果"))]), [FormControl("展示范围", Select("range", [SelectItem("3", "最近3天"), SelectItem("7", "全部7天")], null, null, $range)), FormControl("备注", TextArea("remark"))])
$range = "7"
kpiRow = Stack([TextContent("" + @Sum(sales)), TextContent("" + @Round(@Avg(sales), 1))], "row", "m", "stretch", true)
chart = LineChart(labels, [Series("销售额", sales)], "natural", "日期", "销售额", 260)
table = Table([Col("日期", labels), Col("销售额", sales, "number")])
labels = ["10月1日", "10月2日", "10月3日", "10月4日", "10月5日", "10月6日", "10月7日"]
sales = [1200, 1800, 1500, 2300, 2100, 2800, 3200]`
    await act(async () => root.render(<GeneratedUiTheme><GeneratedUiView source={source} streaming={false} block={block} projectId="p" conversationId="c" /></GeneratedUiTheme>))
    expect(host.textContent).not.toMatch(/界面.*(?:无效|无法显示)/)
    expect(host.textContent).toContain("14900")
    expect(host.textContent).toContain("2128.6")
    expect(host.querySelector("table")).not.toBeNull()
    expect(host.querySelector('[class*="chart"]')).not.toBeNull()
    const remark = host.querySelector("textarea")!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(remark, "说明峰值")
      remark.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const submit = [...host.querySelectorAll("button")].find((button) => button.textContent === "更新结果")!
    await act(async () => submit.click())
    expect(bridge.submitGeneratedUiAction).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "c", formState: expect.objectContaining({ $range: "7", filter: expect.objectContaining({ remark: expect.objectContaining({ value: "说明峰值" }) }) }) }))
    vi.unstubAllGlobals()
  })
  it("restores under the application's StrictMode effect replay", async () => {
    await act(async () => root.render(<StrictMode><GeneratedUiView source={'root = Stack([TextContent("Hello")])'} streaming={false} block={block} projectId="p" conversationId="c" /></StrictMode>))
    expect(host.textContent).toContain("Hello")
    expect(host.querySelector("[inert]")).toBeNull()
  })
  it("renders real official components and restores state before enabling interactions", async () => {
    await act(async () => root.render(<GeneratedUiView source={'root = Stack([TextContent("Hello")])'} streaming={false} block={block} projectId="p" conversationId="c" />))
    expect(host.textContent).toContain("Hello")
    expect(bridge.getGeneratedUiState).toHaveBeenCalledWith({ projectId: "p", conversationId: "c", blockId: block.id })
    expect(host.querySelector("[inert]")).toBeNull()
  })
  it("previews streaming output with all controls inert and does not read persistent state", async () => {
    await act(async () => root.render(<GeneratedUiView source={'root = Stack([TextContent("Hello")])'} streaming />))
    expect(host.textContent).toContain("Hello")
    expect(host.querySelector("[inert]")).not.toBeNull()
    expect(bridge.getGeneratedUiState).not.toHaveBeenCalled()
  })
  it("retains copyable source when the UI is unsafe", async () => {
    await act(async () => root.render(<GeneratedUiView source={'root = Stack([])\nx = Query("secret", {})'} streaming={false} />))
    expect(host.textContent).toContain("界面不能直接调用工具")
    expect(host.textContent).toContain("Query")
    expect(bridge.submitGeneratedUiAction).not.toHaveBeenCalled()
  })
  it("redacts sensitive display values after language string decoding", async () => {
    await act(async () => root.render(<GeneratedUiView source={'root = Stack([TextContent("\\u0073k-fixture-secret-token")])'} streaming={false} block={block} projectId="p" conversationId="c" />))
    expect(host.textContent).not.toContain("sk-fixture-secret-token")
    expect(host.textContent).toContain("[key]")
  })
  it.each([
    'root = Stack([TextContent("\\u0021[x](https://example.com/track.png)")])',
    'root = Stack([TextContent("!" + "[x](https://example.com/track.png)")])',
    '$text = "Hello"\nroot = Stack([TextContent($text)])',
  ])("blocks evaluated Markdown image resources before official components mount: %s", async (source) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    bridge.getGeneratedUiState.mockResolvedValue({ revision: 0, state: { $text: "![x](https://example.com/track.png)" }, readOnly: false })
    await act(async () => root.render(<GeneratedUiView source={source} streaming={false} block={block} projectId="p" conversationId="c" />))
    expect(host.querySelector("img,link[as=image]")).toBeNull()
    expect(host.textContent).toMatch(/界面(?:暂时无法显示|包含不支持)/)
  })
  it("renders official table, chart, input, selection and date components", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ font: "", measureText: (text: string) => ({ width: text.length * 7 }) } as unknown as CanvasRenderingContext2D)
    const source = 'root = Stack([Table([Col("Count", [1, 2], "number")]), LineChart(["Jan", "Feb"], [Series("Sales", [1, 2])]), Form("filter", Buttons([Button("Apply", @ToAssistant("Apply"))]), [FormControl("Name", Input("name")), FormControl("Period", Select("period", [SelectItem("month", "Month")])), FormControl("Date", DatePicker("date"))])])'
    await act(async () => root.render(<GeneratedUiTheme><GeneratedUiView source={source} streaming={false} block={block} projectId="p" conversationId="c" /></GeneratedUiTheme>))
    expect(host.textContent).not.toMatch(/界面.*(?:无效|不支持|无法显示)/)
    expect(host.querySelector("table")).not.toBeNull()
    expect(host.querySelector("input")).not.toBeNull()
    expect(host.querySelector('[role="combobox"]')).not.toBeNull()
    expect(host.querySelector('[class*="chart"]')).not.toBeNull()
    expect(host.textContent).toContain("Date")
    expect(host.textContent).not.toContain("界面格式无效")
    vi.unstubAllGlobals()
  })
  it("falls back once when an official component throws in an effect instead of retrying its mount", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
    vi.stubGlobal("matchMedia", () => { throw new Error("simulated browser API failure") })
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ font: "", measureText: () => ({ width: 20 }) } as unknown as CanvasRenderingContext2D)
    await act(async () => root.render(<GeneratedUiView source={'root = Stack([LineChart(["Jan", "Feb"], [Series("Sales", [1, 2])])])'} streaming={false} block={block} projectId="p" conversationId="c" />))
    expect(host.textContent).toContain("界面暂时无法显示")
    expect(host.querySelector("code")!.textContent).toContain("LineChart")
    vi.unstubAllGlobals()
  })
  it("can render the completed block after a failed streaming preview", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
    vi.stubGlobal("matchMedia", () => { throw new Error("preview failure") })
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ font: "", measureText: () => ({ width: 20 }) } as unknown as CanvasRenderingContext2D)
    const source = 'root = Stack([LineChart(["Jan", "Feb"], [Series("Sales", [1, 2])])])'
    await act(async () => root.render(<GeneratedUiView source={source} streaming />))
    expect(host.textContent).toContain("界面暂时无法显示")
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    await act(async () => root.render(<GeneratedUiView source={source} streaming={false} block={block} projectId="p" conversationId="c" />))
    expect(host.querySelector('[class*="chart"]')).not.toBeNull()
    expect(host.textContent).not.toContain("界面暂时无法显示")
    vi.unstubAllGlobals()
  })
  it("checks reactive values again when a local action changes Markdown text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const source = '$text = "Hello"\nroot = Stack([TextContent($text), Buttons([Button("Change", @Set($text, "!" + "[x](https://example.com/track.png)"))])])'
    await act(async () => root.render(<GeneratedUiView source={source} streaming={false} block={block} projectId="p" conversationId="c" />))
    expect(host.textContent).toContain("Hello")
    await act(async () => host.querySelector("button")!.click())
    expect(host.querySelector("img,link[as=image]")).toBeNull()
    expect(host.textContent).toContain("界面暂时无法显示")
  })
  it("scopes official theme variables to UI blocks and gives popup controls the same dark theme", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn()
    await act(async () => root.render(<GeneratedUiTheme><div data-agent-generated-ui=""><Select open><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="month">Month</SelectItem></SelectContent></Select></div></GeneratedUiTheme>))
    const light = document.head.querySelector("style[data-openui-theme]")!.textContent!
    expect(light).toMatch(/^\[data-agent-generated-ui\], \.openui-theme-portal-/)
    expect(document.body.querySelector('[class*="openui-theme-portal-"]')).not.toBeNull()
    await act(async () => { document.documentElement.classList.add("dark"); await Promise.resolve() })
    expect(document.head.querySelector("style[data-openui-theme]")!.textContent).not.toBe(light)
  })
  it("restores a saved date and themes the actual generated date popup through the same provider", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
    bridge.getGeneratedUiState.mockResolvedValue({ revision: 1, state: { filter: { date: { value: "2026-10-21T00:00:00.000Z", componentType: "DatePicker" } } }, readOnly: false })
    const source = 'root = Stack([Form("filter", Buttons([]), [FormControl("Date", DatePicker("date"))])])'
    await act(async () => root.render(<GeneratedUiTheme><GeneratedUiView source={source} streaming={false} block={block} projectId="p" conversationId="c" /></GeneratedUiTheme>))
    expect(host.textContent).toContain("Oct 21, 2026")
    await act(async () => (host.querySelector(".openui-date-picker-renderer-floating-input-container") as HTMLElement).click())
    const popup = document.body.querySelector(".openui-date-picker-renderer-floating-content")!
    expect(popup).not.toBeNull()
    expect(popup.className).toContain("openui-theme-portal-")
    vi.unstubAllGlobals()
  })
  it("preserves sibling forms and bindings when submitting one named form", async () => {
    const state = { first: { days: { value: "30", componentType: "Input" } }, second: { name: { value: "saved", componentType: "Input" } }, $period: "month" }
    bridge.getGeneratedUiState.mockResolvedValue({ revision: 0, state, readOnly: false })
    bridge.saveGeneratedUiState.mockImplementation(async (input) => ({ revision: 1, state: input.state, readOnly: false }))
    const source = 'root = Stack([Form("first", Buttons([Button("Continue", @ToAssistant("Continue"))]), [FormControl("Days", Input("days"))])])'
    await act(async () => root.render(<GeneratedUiView source={source} streaming={false} block={block} projectId="p" conversationId="c" />))
    await act(async () => host.querySelector("button")!.click())
    expect(bridge.submitGeneratedUiAction).toHaveBeenCalledWith(expect.objectContaining({ formState: { first: state.first, $period: "month" } }))
    for (const [input] of bridge.saveGeneratedUiState.mock.calls) expect(input.state).toEqual(state)
  })
  it("sends a real official button action back to its source conversation once", async () => {
    await act(async () => root.render(<GeneratedUiView source={'root = Stack([Buttons([Button("Continue", @ToAssistant("Continue"))])])'} streaming={false} block={block} projectId="p" conversationId="c" />))
    const button = host.querySelector("button")!
    expect(button).not.toBeNull()
    await act(async () => { button.click(); button.click() })
    expect(bridge.submitGeneratedUiAction).toHaveBeenCalledTimes(1)
    expect(bridge.submitGeneratedUiAction).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p", conversationId: "c", blockId: block.id, message: "Continue" }))
  })
})
