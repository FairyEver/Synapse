import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react"
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
  const startRef = useRef<Point | null>(null)
  const currentRef = useRef<Point | null>(null)
  const finishedRef = useRef(false)
  const region = start && current ? normalizeRegion(start, current, offset) : null

  useLayoutEffect(() => {
    rootRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    const root = document.getElementById("root")
    const targets = [document.documentElement, document.body, root].filter((target): target is HTMLElement => Boolean(target))
    for (const target of targets) {
      target.classList.add("bg-transparent")
    }
    return () => {
      for (const target of targets) {
        target.classList.remove("bg-transparent")
      }
    }
  }, [])

  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (finishedRef.current) return
    const point = eventPoint(event)
    startRef.current = point
    currentRef.current = point
    setStart(point)
    setCurrent(point)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!startRef.current || finishedRef.current) return
    const point = eventPoint(event)
    currentRef.current = point
    setCurrent(point)
  }

  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (!startRef.current || !currentRef.current || finishedRef.current) return
    const point = eventPoint(event)
    currentRef.current = point
    setCurrent(point)
    releasePointer(event)
    completeSelection()
  }

  const completeSelection = () => {
    const nextRegion = currentRegion()
    if (!nextRegion) return
    if (nextRegion.width < 2 || nextRegion.height < 2) {
      reset()
      return
    }
    finishedRef.current = true
    try {
      closeWhenBridgeRejectsOrReturnsFalse(
        requireBridgeDomain("screenshot").completeInteractiveCapture(nextRegion),
      )
    } catch {
      closeOverlayFallback()
    }
  }

  const cancel = () => {
    if (finishedRef.current) return
    finishedRef.current = true
    try {
      closeWhenBridgeRejectsOrReturnsFalse(
        requireBridgeDomain("screenshot").cancelInteractiveCapture(),
      )
    } catch {
      closeOverlayFallback()
    }
  }

  const reset = () => {
    startRef.current = null
    currentRef.current = null
    setStart(null)
    setCurrent(null)
  }

  const currentRegion = () => {
    return startRef.current && currentRef.current
      ? normalizeRegion(startRef.current, currentRef.current, offset)
      : null
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
        } else if (event.key === "Enter") {
          event.preventDefault()
          completeSelection()
        }
      }}
      aria-label="截图区域"
    >
      {dragging && region ? (
        <div
          data-testid="screenshot-selection"
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

function releasePointer(event: PointerEvent<HTMLDivElement>): void {
  try {
    event.currentTarget.releasePointerCapture(event.pointerId)
  } catch {
    // Pointer capture can already be released by the browser.
  }
}

function closeOverlayFallback(): void {
  window.close()
}

function closeWhenBridgeRejectsOrReturnsFalse(result: Promise<boolean>): void {
  void result
    .then((completed) => {
      if (!completed) {
        closeOverlayFallback()
      }
    })
    .catch(() => {
      closeOverlayFallback()
    })
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
