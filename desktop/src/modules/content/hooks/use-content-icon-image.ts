import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import type { SynapseContentIconType, SynapseContentType } from "@/types/content"

const ICON_IMAGE_FILE_NAME = "icon.png"
const CONTENT_ICON_IMAGE_PENDING_VALUE = "__synapse_pending_icon_image__"

type UseContentIconImageOptions = {
  contentType: SynapseContentType
  contentId: string | null
  iconType: SynapseContentIconType
  iconImage: string
  mode?: "create" | "edit"
  open?: boolean
  setErrors?: Dispatch<SetStateAction<Partial<Record<string, string>>>>
  updateField?: {
    (field: "iconImage", value: string): void
    (field: "iconType", value: SynapseContentIconType): void
  }
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
  mode,
  open,
  setErrors,
  updateField,
}: UseContentIconImageOptions): UseContentIconImageReturn {
  const logger = useMemo(() => createRendererLogger(`content.icon-image.${contentType}`), [contentType])
  const [iconImagePreview, setIconImagePreview] = useState<string | null>(null)
  const iconImageBytesRef = useRef<Uint8Array | null>(null)
  const blobUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!contentId || !iconImage || iconImage === CONTENT_ICON_IMAGE_PENDING_VALUE || iconType !== "image") {
      return
    }

    let canceled = false
    logger.info("Loading content icon image preview.", {
      contentId,
      contentType,
      mode,
    })

    window.synapse?.resourceRepository.operation
      .readIconImage({ contentType, id: contentId })
      .then((dataUrl) => {
        if (canceled) {
          return
        }

        if (dataUrl) {
          setIconImagePreview(dataUrl)
          logger.info("Content icon image preview loaded.", {
            contentId,
            contentType,
            mode,
          })
          return
        }

        logger.warn("Content icon image preview was empty.", {
          contentId,
          contentType,
          mode,
        })
      })
      .catch((error) => {
        if (!canceled) {
          logger.error("Failed to load content icon image preview.", {
            contentId,
            contentType,
            error,
            mode,
          })
        }
      })

    return () => {
      canceled = true
    }
  }, [contentId, contentType, iconImage, iconType, logger, mode])

  const prevOpenRef = useRef(false)

  useEffect(() => {
    if (prevOpenRef.current && !open) {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
      iconImageBytesRef.current = null
      setIconImagePreview(null)
    }
    prevOpenRef.current = !!open
  }, [open])

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
      iconImageBytesRef.current = null
    }
  }, [])

  const handleIconImageChange = useCallback((blob: Blob) => {
    void blob.arrayBuffer()
      .then((arrayBuffer) => {
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current)
        }
        const url = URL.createObjectURL(blob)
        blobUrlRef.current = url
        iconImageBytesRef.current = new Uint8Array(arrayBuffer)
        setIconImagePreview(url)
        updateField?.("iconType", "image")
        updateField?.("iconImage", CONTENT_ICON_IMAGE_PENDING_VALUE)
        logger.info("Content icon image updated.", {
          contentId,
          contentType,
          mode,
          size: blob.size,
        })

        setErrors?.((prev) => {
          if (!prev.iconImage) return prev
          const { iconImage: _, ...rest } = prev
          return rest
        })
      })
      .catch((error) => {
        logger.error("Failed to read selected content icon image.", {
          contentId,
          contentType,
          error,
          mode,
        })
      })
  }, [contentId, contentType, logger, mode, setErrors, updateField])

  const handleIconImageRemove = useCallback(() => {
    const hadIconImage = Boolean(blobUrlRef.current || iconImagePreview || iconImage || iconImageBytesRef.current)

    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
    iconImageBytesRef.current = null
    setIconImagePreview(null)
    updateField?.("iconImage", "")
    updateField?.("iconType", "icon")

    if (hadIconImage) {
      logger.info("Content icon image removed.", {
        contentId,
        contentType,
        mode,
      })
    }
  }, [contentId, contentType, iconImage, iconImagePreview, logger, mode, updateField])

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

export { CONTENT_ICON_IMAGE_PENDING_VALUE, useContentIconImage }
