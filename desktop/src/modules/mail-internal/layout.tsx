import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"

const NAV_DEFAULT_WIDTH = 176
const LIST_DEFAULT_WIDTH = 384
const NAV_MIN_WIDTH = 144
const LIST_MIN_WIDTH = 288
const DETAIL_MIN_WIDTH = 240
// 列表收至最小宽度后再折叠；导航仍有余量容纳分隔线。
const WIDE_LAYOUT_MIN_WIDTH = NAV_DEFAULT_WIDTH + LIST_MIN_WIDTH + DETAIL_MIN_WIDTH

type MailLayoutProps = {
  navigation: ReactNode
  list: ReactNode
  detail: ReactNode
  showDetail: boolean
}

export function MailLayout({ navigation, list, detail, showDetail }: MailLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | null>(null)
  const navWidthRef = useRef(NAV_DEFAULT_WIDTH)
  const listWidthRef = useRef(LIST_DEFAULT_WIDTH)
  const [wide, setWide] = useState(false)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateLayout = (width: number) => setWide((current) => {
      const next = width >= WIDE_LAYOUT_MIN_WIDTH
      return current === next ? current : next
    })
    updateLayout(container.getBoundingClientRect().width)
    if (typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width === undefined) return
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        updateLayout(width)
      })
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
  }, [])

  return <div ref={containerRef} data-wide={wide} className="group/mail h-full min-h-0 min-w-0 bg-background">
    {wide ? <ResizablePanelGroup orientation="horizontal" className="min-h-0 overflow-hidden">
      <ResizablePanel defaultSize={navWidthRef.current} minSize={NAV_MIN_WIDTH} maxSize={320} groupResizeBehavior="preserve-pixel-size" onResize={(size) => { navWidthRef.current = size.inPixels }}>
        {navigation}
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="调整信箱宽度" />
      <ResizablePanel className="flex min-h-0 min-w-0 flex-col" minSize={LIST_MIN_WIDTH + DETAIL_MIN_WIDTH}>
        {showDetail ? <ResizablePanelGroup orientation="horizontal" className="min-h-0 overflow-hidden">
          <ResizablePanel className="flex min-h-0 min-w-0 flex-col" defaultSize={listWidthRef.current} minSize={LIST_MIN_WIDTH} maxSize={560} groupResizeBehavior="preserve-pixel-size" onResize={(size) => { listWidthRef.current = size.inPixels }}>
            {list}
          </ResizablePanel>
          <ResizableHandle withHandle aria-label="调整信件列表宽度" />
          <ResizablePanel className="flex min-h-0 min-w-0 flex-col" minSize={DETAIL_MIN_WIDTH}>
            {detail}
          </ResizablePanel>
        </ResizablePanelGroup> : list}
      </ResizablePanel>
    </ResizablePanelGroup> : <div className="flex h-full min-h-0 flex-col">
      {navigation}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {list}
        {showDetail && detail}
      </div>
    </div>}
  </div>
}
