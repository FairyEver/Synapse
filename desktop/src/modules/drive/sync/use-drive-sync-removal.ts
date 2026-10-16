import { useEffect, useRef, useState } from "react"
import type { DriveSyncBindingDto, DriveSyncRemovalDisposition, DriveSyncRemovalPreviewDto, DriveSyncRemovalResultDto } from "@synapse/shared"
import { startTrackedOperation } from "@/lib/ui-tracking"
import type { DriveSyncController } from "./use-drive-sync"

export function useDriveSyncRemoval(controller: DriveSyncController, binding: DriveSyncBindingDto, onRemoved: () => void) {
  const [disposition, setDisposition] = useState<DriveSyncRemovalDisposition>(binding.removalDisposition ?? "keep_both")
  const [preview, setPreview] = useState<DriveSyncRemovalPreviewDto | null>(null)
  const [result, setResult] = useState<DriveSyncRemovalResultDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const busyRef = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const previewRequest = useRef(0)
  const controllerRef = useRef(controller)
  controllerRef.current = controller
  async function check(value: DriveSyncRemovalDisposition) {
    const request = ++previewRequest.current
    setPreview(null); setError(null); setConfirmed(false)
    try {
      const response = await controllerRef.current.previewRemoval(binding.id, value)
      if (request === previewRequest.current) setPreview(response)
    } catch (cause) { if (request === previewRequest.current) setError(cause instanceof Error ? cause.message : "无法检查解除影响") }
  }
  useEffect(() => {
    void check(disposition)
    return () => { previewRequest.current += 1 }
  }, [binding.id, disposition])
  return {
    disposition, preview, result, error, busy, confirmed, setConfirmed,
    choose: (value: DriveSyncRemovalDisposition) => { if (!busyRef.current && !result && binding.status !== "removed") setDisposition(value) },
    recheck: () => check(disposition),
    abandon: async () => {
      if (!mounted.current || busyRef.current || controller.readOnly) return
      busyRef.current = true; setBusy(true); setError(null)
      const finish = startTrackedOperation({ component: "drive", eventKey: "drive.sync.binding.cleanup-retain" })
      try {
        const response = await controller.remove(binding.id, "keep_both")
        await controller.refresh()
        if (!mounted.current) return
        if (response.errors.length) { setError(response.errors.join("；")); finish("failure") }
        else { finish("success"); onRemoved() }
      } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "保留剩余文件失败"); finish("failure") }
      finally { busyRef.current = false; if (mounted.current) setBusy(false) }
    },
    apply: async () => {
      if (!mounted.current || busyRef.current || !preview || preview.blockedReason || controller.readOnly || (disposition !== "keep_both" && !confirmed)) return
      busyRef.current = true; setBusy(true); setError(null)
      const finish = startTrackedOperation({ component: "drive", eventKey: "drive.sync.binding.remove" })
      try {
        const response = await controller.remove(binding.id, disposition, preview.confirmationToken)
        if (!mounted.current) return
        setResult(response); setPreview(null); setConfirmed(false)
        await controller.refresh()
        if (!mounted.current) return
        if (response.errors.length) { setError(response.errors.join("；")); finish("failure") }
        else { finish("success"); onRemoved() }
      } catch (cause) { if (mounted.current) { setPreview(null); setConfirmed(false); setError(cause instanceof Error ? cause.message : "解除同步失败") }; finish("failure") }
      finally { busyRef.current = false; if (mounted.current) setBusy(false) }
    },
  }
}
