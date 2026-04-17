import { Children, Fragment, type ReactNode } from "react"
import { Card, CardContent } from "@/components/ui/card"
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
    <Card className={cn("gap-0 py-0", className)}>
      <CardContent className="px-0">
        {sections.map((section, index) => (
          <Fragment key={index}>
            {index > 0 ? <Separator className="bg-border/60" /> : null}
            <div className={cn("px-4 py-4", sectionClassName)}>{section}</div>
          </Fragment>
        ))}
      </CardContent>
    </Card>
  )
}

export { SettingsGroup }
