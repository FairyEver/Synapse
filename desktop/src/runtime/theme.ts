/**
 * Phase 0.6 — Theme placeholder.
 * SPEC §15.9.
 *
 * Phase 0 keeps the existing shadcn / next-themes integration; this module
 * exposes the placeholder ThemeProvider interface so future code can swap
 * implementations without ripping consumers.
 */

export type ThemeMode = "light" | "dark" | "system"

export interface ThemeProvider {
  readonly mode: ThemeMode
  setMode(mode: ThemeMode): void
  subscribe(listener: (mode: ThemeMode) => void): () => void
}

export class InMemoryThemeProvider implements ThemeProvider {
  private current: ThemeMode = "system"
  private readonly listeners = new Set<(mode: ThemeMode) => void>()

  get mode(): ThemeMode {
    return this.current
  }

  setMode(mode: ThemeMode): void {
    this.current = mode
    for (const listener of [...this.listeners]) {
      try {
        listener(mode)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[theme] listener threw", err)
      }
    }
  }

  subscribe(listener: (mode: ThemeMode) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
