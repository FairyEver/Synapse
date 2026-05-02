type StatusPillProps = {
  active: boolean
  activeLabel: string
  inactiveLabel: string
}

function StatusPill({ active, activeLabel, inactiveLabel }: StatusPillProps) {
  return active ? (
    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
      {activeLabel}
    </span>
  ) : (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {inactiveLabel}
    </span>
  )
}

export { StatusPill }
