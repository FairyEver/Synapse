import { useEffect, useState } from "react"
import { getContentIconOption } from "@/lib/content-appearance"
import { cn } from "@/lib/utils"
import { ContentIconBadge } from "@/modules/content/components/content-icon-badge"
import type { SynapseContentIconType, SynapseContentType } from "@/types/content"

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

    let canceled = false

    window.synapse?.content
      .readIconImage({ contentType, id: contentId })
      .then((dataUrl) => {
        if (!canceled && dataUrl) {
          setImageDataUrl(dataUrl)
        }
      })
      .catch(() => {})

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

export { ContentItemIcon }
