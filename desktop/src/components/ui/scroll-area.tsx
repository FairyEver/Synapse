"use client"

import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { debounce, track } from "@/lib/ui-tracking"

const baseViewportClassName =
  "size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1"

function ScrollArea({
  className,
  children,
  onViewportScroll,
  scrollbars = "vertical",
  trackScroll = true,
  viewportClassName,
  viewportRef,
  "data-track": dataTrack,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  "data-track"?: string
  onViewportScroll?: React.UIEventHandler<HTMLDivElement>
  scrollbars?: "vertical" | "horizontal" | "both" | "none"
  trackScroll?: boolean
  viewportClassName?: string
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
          eventKey: dataTrack,
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
      data-scrollbars={scrollbars}
      className={cn("relative min-h-0 overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className={cn(baseViewportClassName, viewportClassName)}
        onScroll={(event) => {
          if (dataTrack && trackScroll) {
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
          }

          onViewportScroll?.(event)
        }}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {scrollbars === "vertical" || scrollbars === "both" ? <ScrollBar /> : null}
      {scrollbars === "horizontal" || scrollbars === "both" ? <ScrollBar orientation="horizontal" /> : null}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function VirtualScrollArea({
  children,
  className,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative size-full min-h-0 overflow-hidden", className)}
      {...props}
    >
      {children}
      <ScrollBar />
    </ScrollAreaPrimitive.Root>
  )
}

const VirtualScrollAreaViewport = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ children, className, style, ...props }, forwardedRef) => {
  const { overflow, ...viewportStyle } = style ?? {}

  return (
    <ScrollAreaPrimitive.Viewport
      ref={forwardedRef}
      data-slot="scroll-area-viewport"
      className={cn(baseViewportClassName, className)}
      style={overflow ? {
        ...viewportStyle,
        overflowX: "hidden",
        overflowY: overflow as React.CSSProperties["overflowY"],
      } : viewportStyle}
      {...props}
    >
      {children}
    </ScrollAreaPrimitive.Viewport>
  )
})

VirtualScrollAreaViewport.displayName = "VirtualScrollAreaViewport"

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
        "flex touch-none p-px transition-colors select-none data-horizontal:h-1.5 data-horizontal:flex-col data-vertical:h-full data-vertical:w-1.5",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border/60 transition-colors hover:bg-border"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar, VirtualScrollArea, VirtualScrollAreaViewport }
