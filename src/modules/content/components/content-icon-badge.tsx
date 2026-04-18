import type { ReactNode } from "react"
import { getContentColorOption } from "@/lib/content-appearance"
import { cn } from "@/lib/utils"

type ContentIconBadgeProps = {
  children: ReactNode
  className?: string
  size?: "md" | "lg"
  tone?: string | null
  title?: string
}

const badgeSizeClassName = {
  md: "size-12 text-lg [&_svg]:size-5",
  lg: "size-14 text-xl [&_svg]:size-6",
} satisfies Record<NonNullable<ContentIconBadgeProps["size"]>, string>

function ContentIconBadge({
  children,
  className,
  size = "md",
  tone,
  title,
}: ContentIconBadgeProps) {
  const colorOption = tone ? getContentColorOption(tone) : null

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg ring-1 ring-border/60",
        badgeSizeClassName[size],
        colorOption ? colorOption.badgeClassName : "bg-muted text-muted-foreground",
        className,
      )}
      title={title}
    >
      {children}
    </div>
  )
}

export { ContentIconBadge }
