import { useEffect, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { getContentIconOption } from "@/lib/content-appearance"
import { cn } from "@/lib/utils"
import { ContentIconBadge } from "@/modules/content/components/content-icon-badge"
import type { SynapseContentIconType, SynapseContentType } from "@/types/content"

const logger = createRendererLogger("content.icon")

const MAX_ICON_IMAGE_CACHE_ENTRIES = 200
const iconImageCache = new Map<string, string>()

function buildCacheKey(contentType: string, contentId: string): string {
  return `${contentType}:${contentId}`
}

function getCachedIconImage(key: string): string | undefined {
  const cached = iconImageCache.get(key)
  if (!cached) return undefined
  iconImageCache.delete(key)
  iconImageCache.set(key, cached)
  return cached
}

function setCachedIconImage(key: string, dataUrl: string): void {
  if (iconImageCache.has(key)) iconImageCache.delete(key)
  iconImageCache.set(key, dataUrl)
  while (iconImageCache.size > MAX_ICON_IMAGE_CACHE_ENTRIES) {
    const oldestKey = iconImageCache.keys().next().value
    if (!oldestKey) return
    iconImageCache.delete(oldestKey)
  }
}

function invalidateIconImageCache(contentType: string, contentId: string): void {
  iconImageCache.delete(buildCacheKey(contentType, contentId))
}

type ContentItemIconProps = {
  className?: string
  contentId?: string
  contentType?: SynapseContentType
  icon: string
  iconType?: SynapseContentIconType
  iconImage?: string
  title?: string
  tone?: string | null
}

function ContentItemIcon({
  className,
  contentId,
  contentType,
  icon,
  iconType,
  iconImage,
  title,
  tone,
}: ContentItemIconProps) {
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (iconType !== "image" || !iconImage || !contentId || !contentType) {
      setImageDataUrl(null)
      return
    }

    const key = buildCacheKey(contentType, contentId)
    const cached = getCachedIconImage(key)
    if (cached) {
      setImageDataUrl(cached)
      return
    }

    let canceled = false

    window.synapse?.resourceRepository.operation
      .readIconImage({ contentType, id: contentId })
      .then((dataUrl) => {
        if (!canceled && dataUrl) {
          setCachedIconImage(key, dataUrl)
          setImageDataUrl(dataUrl)
        }
      })
      .catch((error) => {
        logger.warn("Failed to load icon image.", { contentType, contentId, error })
      })

    return () => {
      canceled = true
    }
  }, [iconType, iconImage, contentId, contentType])

  if (iconType === "image" && imageDataUrl) {
    return (
      <img
        src={imageDataUrl}
        alt={title ?? ""}
        className={cn("size-10 rounded-lg object-cover", className)}
      />
    )
  }

  const iconOption = getContentIconOption(icon)

  return (
    <ContentIconBadge
      className={cn("size-10 [&_svg]:size-6", className)}
      size="md"
      title={title}
      tone={tone}
    >
      {iconOption ? (
        <iconOption.icon aria-hidden="true" />
      ) : (
        <span className="block max-w-full truncate px-1 leading-none">{icon}</span>
      )}
    </ContentIconBadge>
  )
}

export { ContentItemIcon, invalidateIconImageCache }
