import { useEffect, useRef, useState } from "react"
import type { DriveFileReplacePreviewDto, DriveFileReplaceResultDto, DriveItemDto } from "@synapse/shared"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { startTrackedOperation } from "@/lib/ui-tracking"

export function useDriveFileReplace(item: DriveItemDto, onChanged: () => void | Promise<void>, initialFilePath?: string) {
  const [filePath, setFilePath] = useState<string | null>(initialFilePath ?? null)
  const [preview, setPreview] = useState<DriveFileReplacePreviewDto | null>(null)
  const [result, setResult] = useState<DriveFileReplaceResultDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  async function run(eventKey: string, action: () => Promise<void>) {
    if (busyRef.current || !mounted.current) return
    busyRef.current = true; setBusy(true); setError(null)
    const finish = startTrackedOperation({ component: "drive", eventKey })
    try { await action(); finish("success") }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "操作失败，请重试"); finish("failure") }
    finally { busyRef.current = false; if (mounted.current) setBusy(false) }
  }
  async function check(selected: string) {
    setPreview(null)
    const response = await requireSynapseBridge().drive.file.replace.preview({ itemId: item.id, filePath: selected })
    if (mounted.current) setPreview(response)
  }
  useEffect(() => {
    if (initialFilePath) void run("drive.file.replace.preview", () => check(initialFilePath))
  }, [initialFilePath])
  return {
    preview, result, busy, error, filePath,
    choose: () => run("drive.file.replace.choose", async () => {
      const selected = await requireSynapseBridge().driveSync.chooseLocalPath({ kind: "file", mode: "bind_existing", defaultName: item.name })
      if (!selected || !mounted.current) return
      setFilePath(selected)
      await check(selected)
    }),
    recheck: () => run("drive.file.replace.preview", async () => { if (filePath) await check(filePath) }),
    apply: () => run("drive.file.replace.apply", async () => {
      if (!filePath || !preview || preview.blockedReason || result) return
      // A token authorizes only this reviewed snapshot. Any error requires a new preview.
      setPreview(null)
      const updated = await requireSynapseBridge().drive.file.replace.apply({ itemId: item.id, filePath, confirmationToken: preview.confirmationToken })
      if (!mounted.current) return
      setResult(updated)
      await onChanged()
    }),
  }
}
