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
  contentScrollable?: boolean
}

function SidebarContentLayout({
  sidebar,
  children,
  className,
  containerClassName,
  sidebarClassName,
  contentClassName,
  contentScrollable = true,
}: SidebarContentLayoutProps) {
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className={cn("h-full min-h-0 w-full overflow-hidden", containerClassName, className)}
    >
      <ResizablePanel
        defaultSize={220}
        minSize={220}
        maxSize={420}
        groupResizeBehavior="preserve-pixel-size"
      >
        <div
          className={cn(
            "h-full min-h-0 min-w-0 overflow-hidden bg-background px-2 py-2.5",
            sidebarClassName,
          )}
        >
          {sidebar}
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel>
        {contentScrollable ? (
          <ScrollArea
            className={cn(
              "h-full min-h-0 min-w-0 bg-background px-2 py-2.5",
              contentClassName,
            )}
          >
            <div className="min-h-full min-w-0">
              {children}
            </div>
          </ScrollArea>
        ) : (
          <div
            className={cn(
              "h-full min-h-0 min-w-0 overflow-hidden bg-background px-2 py-2.5",
              contentClassName,
            )}
          >
            <div className="h-full min-h-0 overflow-hidden">
              {children}
            </div>
          </div>
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

export { SidebarContentLayout }
