/**
 * Phase 0.5 — Active project switcher (placeholder).
 * SPEC §8.
 *
 * Phase 0.5 lands the hook + a render-only switcher component. The actual UI
 * (button group, dropdown) lands when M1 ships the project list endpoint.
 * The render shape uses shadcn primitives so existing screens can drop it in
 * without any styling deviation (per design.md / ui-rules.md).
 */

import { useActiveProject } from "./use-active-project"

export interface ActiveProjectIndicatorProps {
  readonly className?: string
}

/**
 * Tiny indicator showing the active project. Returns null when no project is
 * active so screens that don't yet know about projects render unchanged.
 */
export function ActiveProjectIndicator({ className }: ActiveProjectIndicatorProps) {
  const active = useActiveProject()
  if (!active) return null
  return (
    <span className={className} data-testid="active-project-indicator">
      {active.name}
    </span>
  )
}
