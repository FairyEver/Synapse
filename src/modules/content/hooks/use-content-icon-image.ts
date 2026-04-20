import { useCallback, useEffect, useRef, useState } from "react"
import type { SynapseContentIconType, SynapseContentType } from "@/types/content"

type UseContentIconImageOptions = {
  contentType: SynapseContentType
  contentId: string | null
  iconType: SynapseContentIconType
  iconImage: string
}

type UseContentIconImageReturn = {
  iconImagePreview: string | null
  iconImageBytes: Uint8Array | null
  handleIconImageChange: (blob: Blob) => void
  handleIconImageRemove: () => void
}

function useContentIconImage({
  contentType,
  contentId,
  iconType,
  iconImage,
}: UseContentIconImageOptions): UseContentIconImageReturn {
  const [iconImagePreview, setIconImagePreview] = useState<string | null>(null)
  const [iconImageBytes, setIconImageBytes] = useState<Uint8Array | null>(null)
  const blobUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!contentId || !iconImage || iconType !== "image") {
      return
    }

    let canceled = false

    window.synapse?.content
      .readIconImage({ contentType, id: contentId })
      .then((dataUrl) => {
        if (!canceled && dataUrl) {
          setIconImagePreview(dataUrl)
        }
      })
      .catch(() => {})

    return () => {
      canceled = true
    }
  }, [contentType, contentId, iconImage, iconType])

  const handleIconImageChange = useCallback((blob: Blob) => {
    void blob.arrayBuffer().then((arrayBuffer) => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
      }
      const url = URL.createObjectURL(blob)
      blobUrlRef.current = url
      setIconImageBytes(new Uint8Array(arrayBuffer))
      setIconImagePreview(url)
    })
  }, [])

  const handleIconImageRemove = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
    setIconImagePreview(null)
    setIconImageBytes(null)
  }, [])

  return {
    iconImagePreview,
    iconImageBytes,
    handleIconImageChange,
    handleIconImageRemove,
  }
}

export { useContentIconImage }
