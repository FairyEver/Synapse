type StatusPillProps = {
  active: boolean
  activeLabel: string
  inactiveLabel: string
  variant?: "default" | "warning"
}

function StatusPill({ active, activeLabel, inactiveLabel, variant = "default" }: StatusPillProps) {
  if (variant === "warning") {
    return (
      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
        {activeLabel || inactiveLabel}
      </span>
    )
  }

  return active ? (
    <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
      {activeLabel}
    </span>
  ) : (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {inactiveLabel}
    </span>
  )
}

export { StatusPill }
