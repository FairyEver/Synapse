import { useEffect, useRef, useState } from "react"
import { ChevronRight, Folder } from "lucide-react"
import type { DriveItemDto } from "@synapse/shared"
import { GuidedChoices } from "@/components/guided-flow"
import { Button } from "@/components/ui/button"
import { FieldError, FieldDescription } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import { syncRemotePath } from "./drive-sync-flow"
import type { DriveSyncController } from "./use-drive-sync"

function useRemotePicker(controller: DriveSyncController, initialParent: { id: string | null; path: string }, onNavigate?: (value: { id: string | null; path: string }) => void) {
  const api = useRef(controller); api.current = controller
  const request = useRef(0)
  const [ancestors, setAncestors] = useState<{ id: string | null; path: string }[]>([initialParent])
  const current = ancestors.at(-1)!
  const [items, setItems] = useState<readonly DriveItemDto[]>([])
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [selected, setSelected] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function load(offset = 0) {
    const version = ++request.current
    setBusy(true); setError(null)
    try {
      const page = await api.current.listRemote(current.id, offset)
      if (version !== request.current) return
      setItems((previous) => offset ? [...previous, ...page.items.filter((item) => !previous.some((entry) => entry.id === item.id))] : page.items)
      setNextOffset(page.nextOffset)
    } catch (cause) { if (version === request.current) setError(cause instanceof Error ? cause.message : "云端目录加载失败") }
    finally { if (version === request.current) setBusy(false) }
  }
  useEffect(() => {
    setItems([]); setSelected(""); setNextOffset(null); void load()
    return () => { request.current += 1 }
  // Navigation owns the request; changing controller object must not restart pagination.
  }, [current.id])
  return { current, items, selected, setSelected, busy, error, nextOffset, load,
    canBack: ancestors.length > 1,
    back: () => {
      const next = ancestors.slice(0, -1)
      setAncestors(next)
      onNavigate?.(next.at(-1) ?? initialParent)
    },
    enter: (item: DriveItemDto) => {
      const next = [...ancestors, { id: item.id, path: syncRemotePath(current.path, item.name) }]
      setAncestors(next)
      onNavigate?.(next.at(-1)!)
    },
  }
}

export function DriveSyncRemotePicker({ controller, kind, chooseParent, initialParent, onSelect, onNavigate }: {
  readonly controller: DriveSyncController
  readonly kind: "file" | "folder"
  readonly chooseParent: boolean
  readonly initialParent: { id: string | null; path: string }
  readonly onSelect: (item: DriveItemDto, path: string) => void
  readonly onNavigate?: (value: { id: string | null; path: string }) => void
}) {
  const browser = useRemotePicker(controller, initialParent, chooseParent ? onNavigate : undefined)
  const selected = browser.items.find((item) => item.id === browser.selected)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" disabled={!browser.canBack || browser.busy} onClick={browser.back}>上级目录</Button>
        <span className="min-w-0 break-all text-sm">{browser.current.path}</span>
      </div>
      {browser.error && <FieldError>{browser.error}<Button variant="link" onClick={() => { void browser.load() }}>重试</Button></FieldError>}
      {browser.busy && !browser.items.length ? <Skeleton className="h-24 w-full" /> : chooseParent ? (
          <div className="flex flex-col gap-2">
            <div className="text-base font-medium">云端文件夹</div>
            <ScrollArea className="max-h-64" scrollbars="vertical">
              <div className="flex flex-col gap-1" role="list" aria-label="云端文件夹">
                {browser.items.filter((item) => item.type === "folder").map((item) => (
                  <Button key={item.id} type="button" variant="ghost" className="h-auto w-full justify-between px-3 py-2 text-left"
                    disabled={browser.busy} onClick={() => browser.enter(item)}>
                    <span className="flex min-w-0 items-center gap-2"><Folder aria-hidden="true" /><span className="truncate">{item.name}</span></span>
                    <ChevronRight aria-hidden="true" className="shrink-0 text-muted-foreground" />
                  </Button>
                ))}
              </div>
            </ScrollArea>
          </div>
        ) : (
          <ScrollArea className="max-h-64" scrollbars="vertical">
            <GuidedChoices title="云端对象" value={browser.selected} disabled={browser.busy}
              options={browser.items.filter((item) => item.type === "folder" || kind === "file").map((item) => ({
                value: item.id, title: item.name, description: item.type === "folder" ? "文件夹" : "文件",
              }))}
              onChange={(id) => {
                browser.setSelected(id)
                const item = browser.items.find((candidate) => candidate.id === id)
                if (item && item.type === kind) onSelect(item, syncRemotePath(browser.current.path, item.name))
              }} />
          </ScrollArea>
        )}
      {!browser.busy && !browser.error && !browser.items.length && <FieldDescription>此目录为空</FieldDescription>}
      <div className="flex flex-wrap gap-2">
        {!chooseParent && selected?.type === "folder" && <Button variant="outline" disabled={browser.busy} onClick={() => browser.enter(selected)}>打开所选文件夹</Button>}
        {browser.nextOffset !== null && <Button variant="ghost" disabled={browser.busy} onClick={() => { void browser.load(browser.nextOffset!) }}>加载更多</Button>}
      </div>
    </div>
  )
}
