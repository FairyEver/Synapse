import { useEffect, useRef, type CSSProperties } from "react"
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
        option={option}
        opts={CHART_RENDERER}
        style={style}
      />
    </div>
  )
}
