import { useCallback, useRef, useState, type ComponentProps, type ReactNode } from "react"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { readSidebarWidth, writeSidebarWidth } from "@/lib/sidebar-layout-storage"
import { cn } from "@/lib/utils"

type SidebarContentLayoutProps = {
  sidebar: ReactNode
  children: ReactNode
  className?: string
  containerClassName?: string
  sidebarClassName?: string
  contentClassName?: string
  contentLayout?: "default" | "fill" | "center"
  contentScrollable?: boolean
  sidebarResizable?: boolean
  sidebarPersistenceId?: string
  sidebarDefaultSize?: number
  sidebarMinSize?: number
  sidebarMaxSize?: number
}

function SidebarContentLayout({
  sidebar,
  children,
  className,
  containerClassName,
  sidebarClassName,
  contentClassName,
  contentLayout = "default",
  contentScrollable = true,
  sidebarResizable = false,
  sidebarPersistenceId,
  sidebarDefaultSize = 220,
  sidebarMinSize = 220,
  sidebarMaxSize = 420,
}: SidebarContentLayoutProps) {
  const [initialSidebarSize] = useState(() => (
    sidebarResizable && sidebarPersistenceId
      ? readSidebarWidth(sidebarPersistenceId, {
          defaultSize: sidebarDefaultSize,
          minSize: sidebarMinSize,
          maxSize: sidebarMaxSize,
        })
      : sidebarDefaultSize
  ))
  const latestSidebarSizeRef = useRef(initialSidebarSize)
  const handleSidebarResize = useCallback<
    NonNullable<ComponentProps<typeof ResizablePanel>["onResize"]>
  >((size) => {
    latestSidebarSizeRef.current = size.inPixels
  }, [])
  const handleLayoutChanged = useCallback<
    NonNullable<ComponentProps<typeof ResizablePanelGroup>["onLayoutChanged"]>
  >(() => {
    if (!sidebarResizable || !sidebarPersistenceId) return

    writeSidebarWidth(sidebarPersistenceId, latestSidebarSizeRef.current, {
      minSize: sidebarMinSize,
      maxSize: sidebarMaxSize,
    })
  }, [sidebarMaxSize, sidebarMinSize, sidebarPersistenceId, sidebarResizable])
  const contentInnerClassName = cn(
    contentScrollable ? "min-h-full min-w-0" : "h-full min-h-0 overflow-hidden",
    contentLayout === "fill" && "flex flex-col",
    contentLayout === "center" && "flex flex-col items-center justify-center p-6 text-center",
  )

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      onLayoutChanged={sidebarResizable && sidebarPersistenceId ? handleLayoutChanged : undefined}
      className={cn("h-full min-h-0 w-full overflow-hidden", containerClassName, className)}
    >
      <ResizablePanel
        defaultSize={initialSidebarSize}
        minSize={sidebarMinSize}
        maxSize={sidebarResizable ? sidebarMaxSize : sidebarDefaultSize}
        disabled={!sidebarResizable}
        groupResizeBehavior="preserve-pixel-size"
        onResize={sidebarResizable && sidebarPersistenceId ? handleSidebarResize : undefined}
      >
        <div
          className={cn(
            "h-full min-h-0 min-w-0 overflow-hidden bg-background",
            sidebarClassName,
          )}
        >
          {sidebar}
        </div>
      </ResizablePanel>

      {sidebarResizable ? <ResizableHandle withHandle /> : null}

      <ResizablePanel>
        {contentScrollable ? (
          <ScrollArea
            className={cn(
              "h-full min-h-0 min-w-0 bg-background",
              contentClassName,
            )}
          >
            <div className={contentInnerClassName}>
              {children}
            </div>
          </ScrollArea>
        ) : (
          <div
            className={cn(
              "h-full min-h-0 min-w-0 overflow-hidden bg-background",
              contentClassName,
            )}
          >
            <div className={contentInnerClassName}>
              {children}
            </div>
          </div>
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

export { SidebarContentLayout }
