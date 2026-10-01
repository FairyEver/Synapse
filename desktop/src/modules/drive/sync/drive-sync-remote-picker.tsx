import { useEffect, useRef, useState } from "react"
import type { DriveItemDto } from "@synapse/shared"
import { GuidedChoices } from "@/components/guided-flow"
import { Button } from "@/components/ui/button"
import { FieldError, FieldDescription } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { syncRemotePath } from "./drive-sync-flow"
import type { DriveSyncController } from "./use-drive-sync"

function useRemotePicker(controller: DriveSyncController) {
  const api = useRef(controller); api.current = controller
  const request = useRef(0)
  const [ancestors, setAncestors] = useState<{ id: string | null; path: string }[]>([{ id: null, path: "/" }])
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
    back: () => setAncestors((previous) => previous.slice(0, -1)),
    enter: (item: DriveItemDto) => setAncestors((previous) => [...previous, { id: item.id, path: syncRemotePath(current.path, item.name) }]),
  }
}

export function DriveSyncRemotePicker({ controller, kind, chooseParent, onSelect, onParent }: {
  readonly controller: DriveSyncController
  readonly kind: "file" | "folder"
  readonly chooseParent: boolean
  readonly onSelect: (item: DriveItemDto, path: string) => void
  readonly onParent: (value: { id: string | null; path: string }) => void
}) {
  const browser = useRemotePicker(controller)
  const selected = browser.items.find((item) => item.id === browser.selected)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" disabled={!browser.canBack || browser.busy} onClick={browser.back}>上级目录</Button>
        <span className="min-w-0 break-all text-sm">{browser.current.path}</span>
      </div>
      {browser.error && <FieldError>{browser.error}<Button variant="link" onClick={() => { void browser.load() }}>重试</Button></FieldError>}
      {browser.busy && !browser.items.length ? <Skeleton className="h-24 w-full" /> : (
        <GuidedChoices title={chooseParent ? "云端存放目录" : "云端对象"} value={browser.selected} disabled={browser.busy}
          options={browser.items.filter((item) => item.type === "folder" || (!chooseParent && kind === "file")).map((item) => ({
            value: item.id, title: item.name, description: item.type === "folder" ? "文件夹" : "文件",
          }))}
          onChange={(id) => {
            browser.setSelected(id)
            const item = browser.items.find((candidate) => candidate.id === id)
            if (item && chooseParent && item.type === "folder") onParent({ id: item.id, path: syncRemotePath(browser.current.path, item.name) })
            if (item && !chooseParent && item.type === kind) onSelect(item, syncRemotePath(browser.current.path, item.name))
          }} />
      )}
      {!browser.busy && !browser.error && !browser.items.length && <FieldDescription>此目录为空</FieldDescription>}
      <div className="flex flex-wrap gap-2">
        {selected?.type === "folder" && <Button variant="outline" disabled={browser.busy} onClick={() => browser.enter(selected)}>打开所选文件夹</Button>}
        {chooseParent && <Button variant="outline" disabled={browser.busy || Boolean(browser.error)} onClick={() => onParent(browser.current)}>使用当前目录</Button>}
        {browser.nextOffset !== null && <Button variant="ghost" disabled={browser.busy} onClick={() => { void browser.load(browser.nextOffset!) }}>加载更多</Button>}
      </div>
    </div>
  )
}
