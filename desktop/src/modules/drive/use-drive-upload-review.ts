import { useCallback, useEffect, useRef, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { startTrackedOperation } from "@/lib/ui-tracking"
import type { DriveLocalUploadRequest } from "@/types/bridge"
import { reviewDriveLocalUpload, type DriveLocalUploadReview } from "./drive-local-upload-review"

async function inspect(request: DriveLocalUploadRequest) {
  return reviewDriveLocalUpload(request, {
    list: async (parentId, offset) => {
      const result = await requireSynapseBridge().drive.item.list({ parentId, offset, limit: 100 })
      return Array.isArray(result) ? { items: result, nextOffset: null } : { items: result.items, nextOffset: result.page.nextOffset }
    },
    preview: (itemId, filePath) => requireSynapseBridge().drive.file.replace.preview({ itemId, filePath }),
  })
}
export function useDriveUploadReview() {
  const [review, setReview] = useState<DriveLocalUploadReview | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingRef = useRef(false)
  const checkingRef = useRef(false)
  const originalRef = useRef<DriveLocalUploadRequest | null>(null)
  const resolveRef = useRef<((request: DriveLocalUploadRequest | null) => void) | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; resolveRef.current?.(null); resolveRef.current = null }
  }, [])
  const reviewRequest = useCallback(async (request: DriveLocalUploadRequest): Promise<DriveLocalUploadRequest | null> => {
    if (pendingRef.current) throw new Error("请先完成当前上传确认")
    pendingRef.current = true; setChecking(true); setError(null)
    const finish = startTrackedOperation({ component: "drive", eventKey: "drive.upload.review" })
    try {
      const next = await inspect(request)
      if (!mounted.current) { finish("cancelled"); return null }
      setChecking(false)
      if (!next.replacements.length) { finish("success"); return next.request }
      originalRef.current = request; setReview(next)
      const accepted = await new Promise<DriveLocalUploadRequest | null>((resolve) => { resolveRef.current = resolve })
      finish(accepted ? "success" : "cancelled")
      return accepted
    } catch (cause) { finish("failure"); throw cause }
    finally { pendingRef.current = false; if (mounted.current) setChecking(false) }
  }, [])
  function complete(request: DriveLocalUploadRequest | null) {
    if (checkingRef.current) return
    const resolve = resolveRef.current; resolveRef.current = null
    setReview(null); setError(null); originalRef.current = null
    resolve?.(request)
  }
  return {
    review, checking, pending: checking || Boolean(review), error, reviewRequest,
    cancel: () => complete(null),
    confirm: () => { if (review && !error && !review.replacements.some((item) => item.preview.blockedReason)) complete(review.request) },
    recheck: async () => {
      if (checkingRef.current || !originalRef.current) return
      checkingRef.current = true; setChecking(true); setError(null)
      try { const next = await inspect(originalRef.current); if (mounted.current) setReview(next) }
      catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "检查失败，请重试") }
      finally { checkingRef.current = false; if (mounted.current) setChecking(false) }
    },
  }
}
export type DriveUploadReviewController = ReturnType<typeof useDriveUploadReview>
