import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type ModuleMetric = {
  label: string
  value: ReactNode
  description: string
}

type ModuleHeroProps = {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
  className?: string
  metrics?: ModuleMetric[]
}

type ModulePanelProps = {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}

type ModuleNoteProps = {
  title: string
  children: ReactNode
  className?: string
  tone?: "default" | "muted"
}

export function ModuleHero({ eyebrow, title, description, actions, className, metrics }: ModuleHeroProps) {
  return (
    <section className={cn("surface-panel grid gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_19rem]", className)}>
      <div className="space-y-5">
        <div className="eyebrow">{eyebrow}</div>

        <div className="space-y-3">
          <h1 className="font-editorial text-[2.2rem] leading-[1.12] text-foreground sm:text-[2.85rem]">{title}</h1>
          <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">{description}</p>
        </div>

        {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </div>

      {metrics?.length ? (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          {metrics.map((metric) => (
            <article key={metric.label} className="surface-note bg-secondary px-4 py-4">
              <div className="eyebrow">{metric.label}</div>
              <div className="mt-3 font-editorial text-[1.7rem] leading-none text-foreground">{metric.value}</div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{metric.description}</p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}

export function ModulePanel({ title, description, action, children, className }: ModulePanelProps) {
  return (
    <section className={cn("surface-panel p-5 sm:p-6", className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <h2 className="font-editorial text-[1.55rem] leading-tight text-foreground">{title}</h2>
          {description ? <p className="text-sm leading-6 text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="text-sm text-muted-foreground">{action}</div> : null}
      </div>

      <div className="mt-5">{children}</div>
    </section>
  )
}

export function ModuleNote({ title, children, className, tone = "default" }: ModuleNoteProps) {
  return (
    <section
      className={cn(
        "surface-note px-5 py-5",
        tone === "muted" ? "surface-note-muted" : "bg-card",
        className,
      )}
    >
      <h2 className="font-editorial text-[1.3rem] leading-tight text-foreground">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}
