/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { UsageTodayHourlyChart, UsageTrendChart } from "../shared/components/usage-charts"

const mocks = vi.hoisted(() => ({
  chartOptions: [] as unknown[],
  chartEvents: [] as Record<string, (params: unknown) => void>[],
  resize: vi.fn(),
}))

vi.mock("echarts-for-react", async () => {
  const React = await vi.importActual<typeof import("react")>("react")
  return {
    default: React.forwardRef(({
      className,
      option,
      onEvents,
      style,
    }: {
      readonly className?: string
      readonly option: unknown
      readonly onEvents?: Record<string, (params: unknown) => void>
      readonly style?: React.CSSProperties
    }, ref) => {
      React.useImperativeHandle(ref, () => ({
        getEchartsInstance: () => ({
          resize: mocks.resize,
        }),
      }))
      mocks.chartOptions.push(option)
      if (onEvents) {
        mocks.chartEvents.push(onEvents)
      }
      return <div className={className} data-echarts-chart="" style={style} />
    }),
  }
})

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const resizeObservers: FakeResizeObserver[] = []

class FakeResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObservers.push(this)
  }

  observe() {}
  unobserve() {}
  disconnect() {}

  notify() {
    this.callback([], this as unknown as ResizeObserver)
  }
}

;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver

;(globalThis as typeof globalThis & {
  requestAnimationFrame: typeof requestAnimationFrame
  cancelAnimationFrame: typeof cancelAnimationFrame
}).requestAnimationFrame = (callback) => {
  callback(0)
  return 1
}

;(globalThis as typeof globalThis & {
  cancelAnimationFrame: typeof cancelAnimationFrame
}).cancelAnimationFrame = () => {}

let roots: Root[] = []

beforeEach(() => {
  mocks.chartOptions.length = 0
  mocks.chartEvents.length = 0
  mocks.resize.mockClear()
  resizeObservers.length = 0
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("UsageTrendChart", () => {
  it("shows the bucket granularity switch before token mode tabs", () => {
    const html = renderToStaticMarkup(<UsageTrendChart title="Token 趋势" rows={[]} />)

    expect(html).toContain("按天")
    expect(html).toContain("按小时")
    expect(html.indexOf("按小时")).toBeLessThan(html.indexOf("按天"))
    expect(html.indexOf("按天")).toBeLessThan(html.indexOf("全部"))
    expect(html).toContain("新增")
  })
})

describe("UsageTodayHourlyChart", () => {
  it("preserves hidden token components when rows refresh", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<UsageTodayHourlyChart title="今日时段" rows={[todayRow("2026-05-20 09", 100)]} />)
    })

    await act(async () => {
      mocks.chartEvents.at(-1)?.legendselectchanged?.({
        selected: {
          输入: true,
          输出: false,
          缓存读: false,
          缓存写: true,
          推理: true,
          请求: true,
        },
      })
    })

    await act(async () => {
      root.render(<UsageTodayHourlyChart title="今日时段" rows={[todayRow("2026-05-20 09", 150)]} />)
    })

    const option = mocks.chartOptions.at(-1) as {
      readonly legend?: { readonly selected?: Record<string, boolean> }
    }

    expect(option.legend?.selected?.输出).toBe(false)
    expect(option.legend?.selected?.缓存读).toBe(false)
  })

  it("resizes the chart when its container changes size", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<UsageTodayHourlyChart title="今日时段" rows={[{
        bucket: "2026-05-20 00",
        tokens: 100,
        estimatedCost: 0,
        requests: 1,
        toolCalls: 0,
        modelBreakdown: [{
          model: "gpt",
          tokens: 100,
          input: 60,
          output: 20,
          cacheRead: 10,
          cacheWrite: 5,
          reasoning: 5,
        }],
      }]} />)
    })

    expect(resizeObservers.length).toBeGreaterThan(0)

    await act(async () => {
      resizeObservers.at(-1)?.notify()
    })

    expect(mocks.resize).toHaveBeenCalled()
  })

  it("shows every hour segment label from 01 to 24", () => {
    renderToStaticMarkup(<UsageTodayHourlyChart title="今日时段" rows={Array.from({ length: 24 }, (_, hour) => ({
      bucket: `2026-05-20 ${String(hour).padStart(2, "0")}`,
      tokens: 0,
      estimatedCost: 0,
      requests: 0,
      toolCalls: 0,
      modelBreakdown: [],
    }))} />)

    const option = mocks.chartOptions.at(-1) as {
      readonly xAxis?: {
        readonly data?: string[]
        readonly axisLabel?: { readonly interval?: number }
      }
    }

    expect(option.xAxis?.data).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
      "09",
      "10",
      "11",
      "12",
      "13",
      "14",
      "15",
      "16",
      "17",
      "18",
      "19",
      "20",
      "21",
      "22",
      "23",
      "24",
    ])
    expect(option.xAxis?.axisLabel?.interval).toBe(0)
  })
})

function todayRow(bucket: string, tokens: number) {
  return {
    bucket,
    tokens,
    estimatedCost: 0,
    requests: 1,
    toolCalls: 0,
    modelBreakdown: [{
      model: "gpt",
      tokens,
      input: 60,
      output: 20,
      cacheRead: 10,
      cacheWrite: 5,
      reasoning: 5,
    }],
  }
}
