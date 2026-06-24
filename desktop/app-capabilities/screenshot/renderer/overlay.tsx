import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import type { ScreenshotRegion } from "../shared/schema"

type Point = {
  readonly x: number
  readonly y: number
}

function searchNumber(name: string): number {
  const value = new URLSearchParams(window.location.search).get(name)
  const parsed = value ? Number(value) : 0
  return Number.isFinite(parsed) ? parsed : 0
}

export function ScreenshotOverlayApp() {
  const offset = useMemo(() => ({
    x: searchNumber("offsetX"),
    y: searchNumber("offsetY"),
  }), [])
  const [start, setStart] = useState<Point | null>(null)
  const [current, setCurrent] = useState<Point | null>(null)
  const dragging = Boolean(start && current)
  const rootRef = useRef<HTMLDivElement>(null)
  const region = start && current ? normalizeRegion(start, current, offset) : null

  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  const begin = (event: PointerEvent<HTMLDivElement>) => {
    const point = eventPoint(event)
    setStart(point)
    setCurrent(point)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!start) return
    setCurrent(eventPoint(event))
  }

  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (!region) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (region.width < 2 || region.height < 2) {
      reset()
      return
    }
    void requireBridgeDomain("screenshot").completeInteractiveCapture(region)
  }

  const cancel = () => {
    void requireBridgeDomain("screenshot").cancelInteractiveCapture()
  }

  const reset = () => {
    setStart(null)
    setCurrent(null)
  }

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      className="fixed inset-0 cursor-crosshair select-none bg-transparent outline-none"
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          cancel()
        }
      }}
      aria-label="截图区域"
    >
      {dragging && region ? (
        <div
          className="fixed border-2 border-primary bg-primary/10"
          style={{
            left: `${region.x - offset.x}px`,
            top: `${region.y - offset.y}px`,
            width: `${region.width}px`,
            height: `${region.height}px`,
          }}
        />
      ) : null}
    </div>
  )
}

function eventPoint(event: PointerEvent<HTMLDivElement>): Point {
  return {
    x: event.clientX,
    y: event.clientY,
  }
}

export function normalizeRegion(start: Point, end: Point, offset: Point): ScreenshotRegion {
  const left = Math.min(start.x, end.x)
  const top = Math.min(start.y, end.y)
  const right = Math.max(start.x, end.x)
  const bottom = Math.max(start.y, end.y)
  return {
    x: Math.round(left + offset.x),
    y: Math.round(top + offset.y),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  }
}
