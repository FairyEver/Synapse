"use client"

import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { debounce, track } from "@/lib/ui-tracking"

function ScrollArea({
  className,
  children,
  viewportRef,
  "data-track": dataTrack,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  "data-track"?: string
  viewportRef?: React.Ref<HTMLDivElement>
}) {
  const lastScrollTopRef = React.useRef(0)
  const logScroll = React.useMemo(
    () => dataTrack
      ? debounce((snapshot: {
        clientHeight: number
        direction: "down" | "up"
        percent: number
        scrollHeight: number
        scrollTop: number
      }) => {
        track({
          component: "scroll-area",
          name: dataTrack,
          action: "scroll",
          value: snapshot.percent,
          metadata: snapshot,
        })
      }, 500)
      : null,
    [dataTrack],
  )

  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      data-track={dataTrack}
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className="size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1"
        onScroll={(event) => {
          if (!dataTrack) {
            return
          }

          const target = event.currentTarget
          const scrollTop = target.scrollTop
          const scrollable = Math.max(1, target.scrollHeight - target.clientHeight)
          const direction = scrollTop >= lastScrollTopRef.current ? "down" : "up"
          lastScrollTopRef.current = scrollTop
          logScroll?.({
            clientHeight: target.clientHeight,
            direction,
            percent: Math.round((scrollTop / scrollable) * 100),
            scrollHeight: target.scrollHeight,
            scrollTop,
          })
        }}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
