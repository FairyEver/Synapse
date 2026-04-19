import { getContentIconOption } from "@/lib/content-appearance"
import { cn } from "@/lib/utils"
import { ContentIconBadge } from "@/modules/content/components/content-icon-badge"

type ContentItemIconProps = {
  className?: string
  icon: string
  title?: string
  tone?: string | null
}

function ContentItemIcon({
  className,
  icon,
  title,
  tone,
}: ContentItemIconProps) {
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
