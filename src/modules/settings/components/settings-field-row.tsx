import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

const SETTINGS_FIELD_CONTROL_CLASSNAME = "w-full md:w-[200px]"

type SettingsFieldRowProps = {
  children: ReactNode
  className?: string
  controlClassName?: string
  description?: string
  error?: string | null
  label: string
}

function SettingsFieldRow({
  children,
  className,
  controlClassName = SETTINGS_FIELD_CONTROL_CLASSNAME,
  description,
  error,
  label,
}: SettingsFieldRowProps) {
  return (
    <div
      className={cn(
        "grid gap-x-6 gap-y-2 md:grid-cols-[minmax(0,1fr)_200px] md:items-center",
        className,
      )}
    >
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className={cn("w-full md:justify-self-end", controlClassName)}>{children}</div>

      {description || error ? (
        <div className="flex flex-col gap-1">
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

export { SettingsFieldRow, SETTINGS_FIELD_CONTROL_CLASSNAME }
