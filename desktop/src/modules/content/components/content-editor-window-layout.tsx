import type { ReactNode } from "react"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"

type ContentEditorWindowLayoutProps = {
  actions: ReactNode
  auxiliary: ReactNode
  body: ReactNode
  meta: ReactNode
  title: string
}

function ContentEditorWindowLayout({
  actions,
  auxiliary,
  body,
  meta,
  title,
}: ContentEditorWindowLayoutProps) {
  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <h1 className="min-w-0 flex-1 truncate text-base font-medium">{title}</h1>
        {actions ? (
          <div className="flex shrink-0 items-center gap-3">
            {actions}
          </div>
        ) : null}
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">
        <ResizablePanelGroup orientation="horizontal" className="h-full min-h-0">
          <ResizablePanel
            defaultSize={288}
            minSize={240}
            maxSize={420}
            groupResizeBehavior="preserve-pixel-size"
          >
            <aside className="h-full min-h-0 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="p-4">{meta}</div>
              </ScrollArea>
            </aside>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel minSize={420}>
            <section className="h-full min-h-0 overflow-hidden p-4">
              {body}
            </section>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize={352}
            minSize={280}
            maxSize={560}
            groupResizeBehavior="preserve-pixel-size"
          >
            <aside className="h-full min-h-0 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="p-4">{auxiliary}</div>
              </ScrollArea>
            </aside>
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>
    </div>
  )
}

export { ContentEditorWindowLayout }
