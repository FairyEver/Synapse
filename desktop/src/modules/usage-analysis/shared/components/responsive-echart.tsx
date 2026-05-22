import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"
import { cn } from "@/lib/utils"

interface ResponsiveEChartProps {
  readonly className?: string
  readonly option: EChartsOption
  readonly style?: CSSProperties
}

const CHART_RENDERER = { renderer: "canvas" as const }

export function ResponsiveEChart({ className, option, style }: ResponsiveEChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<InstanceType<typeof ReactECharts> | null>(null)
  const frameRef = useRef<number | null>(null)
  const [legendSelection, setLegendSelection] = useState<Record<string, boolean>>({})
  const optionWithLegendSelection = useMemo(
    () => applyLegendSelection(option, legendSelection),
    [legendSelection, option],
  )
  const chartEvents = useMemo(() => ({
    legendselectchanged: (params: unknown) => {
      if (!isLegendSelectChangedEvent(params)) return
      setLegendSelection(params.selected)
    },
  }), [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    const cancelScheduledResize = () => {
      if (frameRef.current === null) return
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }

    const resize = () => {
      cancelScheduledResize()
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null
        chartRef.current?.getEchartsInstance().resize({ width: "auto", height: "auto" })
      })
    }

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", resize)
      resize()

      return () => {
        window.removeEventListener("resize", resize)
        cancelScheduledResize()
      }
    }

    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()

    return () => {
      observer.disconnect()
      cancelScheduledResize()
    }
  }, [])

  return (
    <div ref={containerRef} className="min-w-0 max-w-full overflow-hidden" data-usage-responsive-chart="">
      <ReactECharts
        ref={chartRef}
        autoResize={false}
        className={cn("min-w-0 w-full", className)}
        lazyUpdate
        notMerge
        onEvents={chartEvents}
        option={optionWithLegendSelection}
        opts={CHART_RENDERER}
        style={style}
      />
    </div>
  )
}

function applyLegendSelection(option: EChartsOption, selection: Record<string, boolean>): EChartsOption {
  if (Object.keys(selection).length === 0) return option

  const current = option as EChartsOption & { readonly legend?: object | object[] }
  if (!current.legend) return option

  return {
    ...option,
    legend: Array.isArray(current.legend)
      ? current.legend.map((legend) => mergeLegendSelection(legend, selection))
      : mergeLegendSelection(current.legend, selection),
  } as EChartsOption
}

function mergeLegendSelection(legend: object, selection: Record<string, boolean>): object {
  const currentSelection = readLegendSelection(legend)

  return {
    ...legend,
    selected: {
      ...currentSelection,
      ...selection,
    },
  }
}

function readLegendSelection(legend: object): Record<string, boolean> {
  const selected = (legend as { readonly selected?: unknown }).selected
  return typeof selected === "object" && selected !== null
    ? selected as Record<string, boolean>
    : {}
}

function isLegendSelectChangedEvent(value: unknown): value is { selected: Record<string, boolean> } {
  if (typeof value !== "object" || value === null || !("selected" in value)) return false
  const selected = (value as { readonly selected?: unknown }).selected
  return typeof selected === "object" && selected !== null
}
