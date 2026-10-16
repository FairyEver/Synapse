import { useCallback, useEffect, useState } from "react"
import type { DriveItemDto, DriveShareListItemDto } from "@synapse/shared"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { driveErrorMessage } from "@/lib/drive-format"

export function useDriveShareDetails(item: DriveItemDto, open: boolean) {
  const shareId = item.activeShareId ?? item.activeShare?.id
  const [revision, setRevision] = useState(0)
  const [clock, setClock] = useState(Date.now)
  const [state, setState] = useState<{ readonly key: string; readonly data?: DriveShareListItemDto; readonly error?: string } | null>(null)
  const key = JSON.stringify([item.id, shareId, revision])
  useEffect(() => {
    if (!open || !shareId) return
    let disposed = false
    setState(null)
    void requireSynapseBridge().drive.share.get({ shareId }).then((data) => {
      if (data.itemId !== item.id) throw new Error("分享信息已变化，请刷新文件列表。")
      if (!disposed) setState({ key, data })
    }).catch((cause: unknown) => {
      if (!disposed) setState({ key, error: driveErrorMessage(cause, "分享信息加载失败") })
    })
    return () => { disposed = true }
  }, [open, shareId, item.id, key])
  const retry = useCallback(() => setRevision((current) => current + 1), [])
  const current = state?.key === key ? state : null
  const expiry = current?.data ? current.data.expiresAt : item.activeShare?.expiresAt
  const expiryTime = expiry ? Date.parse(expiry) : Number.NaN
  useEffect(() => {
    const remaining = expiryTime - Date.now()
    if (!Number.isFinite(remaining) || remaining <= 0) return
    const timer = setTimeout(() => setClock(Date.now()), Math.min(remaining + 1, 2_000_000_000))
    return () => clearTimeout(timer)
  }, [expiryTime, clock])
  const expired = Number.isFinite(expiryTime) && expiryTime <= Math.max(clock, Date.now())
  return { expired, canRetry: Boolean(shareId), data: current?.data, error: shareId ? current?.error : "分享信息暂不可用，请刷新文件列表。", loading: Boolean(shareId && !current), retry }
}
