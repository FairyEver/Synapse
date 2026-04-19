import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type ContentItemMetaProps = {
  author: string
  category: string
  className?: string
  description: string
  title: string
}

function ContentItemMeta({
  author,
  category,
  className,
  description,
  title,
}: ContentItemMetaProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="min-w-0 flex flex-col gap-0.5">
        <p className="truncate text-sm font-medium leading-4 text-foreground">{title}</p>
        <p className="truncate text-sm leading-4 text-muted-foreground">{description}</p>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="max-w-full truncate">
          @{author}
        </Badge>
        <Badge variant="secondary" className="max-w-full truncate">
          {category}
        </Badge>
      </div>
    </div>
  )
}

export { ContentItemMeta }
