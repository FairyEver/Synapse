import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react"
import type { SynapseContentIconType, SynapseContentType } from "@/types/content"

const ICON_IMAGE_FILE_NAME = "icon.png"

type UseContentIconImageOptions = {
  contentType: SynapseContentType
  contentId: string | null
  iconType: SynapseContentIconType
  iconImage: string
  setErrors?: Dispatch<SetStateAction<Partial<Record<string, string>>>>
  updateField?: (field: "iconImage", value: string) => void
}

type UseContentIconImageReturn = {
  iconImagePreview: string | null
  handleIconImageChange: (blob: Blob) => void
  handleIconImageRemove: () => void
  prepareFormForSubmit: <T extends Record<string, unknown>>(form: T) => T
}

function useContentIconImage({
  contentType,
  contentId,
  iconType,
  iconImage,
  setErrors,
  updateField,
}: UseContentIconImageOptions): UseContentIconImageReturn {
  const [iconImagePreview, setIconImagePreview] = useState<string | null>(null)
  const iconImageBytesRef = useRef<Uint8Array | null>(null)
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
      iconImageBytesRef.current = new Uint8Array(arrayBuffer)
      setIconImagePreview(url)

      setErrors?.((prev) => {
        if (!prev.iconImage) return prev
        const { iconImage: _, ...rest } = prev
        return rest
      })
    })
  }, [setErrors])

  const handleIconImageRemove = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
    iconImageBytesRef.current = null
    setIconImagePreview(null)
    updateField?.("iconImage", "")
  }, [updateField])

  const prepareFormForSubmit = useCallback(<T extends Record<string, unknown>>(form: T): T => {
    if (form.iconType !== "image" || !iconImageBytesRef.current) {
      return form
    }
    return { ...form, iconImageBytes: iconImageBytesRef.current, iconImage: ICON_IMAGE_FILE_NAME }
  }, [])

  return {
    iconImagePreview,
    handleIconImageChange,
    handleIconImageRemove,
    prepareFormForSubmit,
  }
}

export { useContentIconImage }
