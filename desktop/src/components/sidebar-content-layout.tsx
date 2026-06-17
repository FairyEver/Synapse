import type { ReactNode } from "react"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
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
}: SidebarContentLayoutProps) {
  const contentInnerClassName = cn(
    contentScrollable ? "min-h-full min-w-0" : "h-full min-h-0 overflow-hidden",
    contentLayout === "fill" && "flex flex-col",
    contentLayout === "center" && "flex flex-col items-center justify-center p-6 text-center",
  )

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className={cn("h-full min-h-0 w-full overflow-hidden", containerClassName, className)}
    >
      <ResizablePanel
        defaultSize={220}
        minSize={220}
        maxSize={sidebarResizable ? 420 : 220}
        disabled={!sidebarResizable}
        groupResizeBehavior="preserve-pixel-size"
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
