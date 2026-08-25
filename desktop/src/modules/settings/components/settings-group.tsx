import { Children, Fragment, type ReactNode } from "react"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

type SettingsGroupProps = {
  children: ReactNode
  className?: string
  sectionClassName?: string
}

function SettingsGroup({ children, className, sectionClassName }: SettingsGroupProps) {
  const sections = Children.toArray(children).filter(Boolean)

  if (sections.length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        "@container/field-group overflow-hidden rounded-lg bg-card text-card-foreground ring-1 ring-foreground/10",
        className,
      )}
    >
      {sections.map((section, index) => (
        <Fragment key={index}>
          {index > 0 ? <Separator /> : null}
          <div className={cn("px-4 py-4", sectionClassName)}>{section}</div>
        </Fragment>
      ))}
    </div>
  )
}

export { SettingsGroup }
