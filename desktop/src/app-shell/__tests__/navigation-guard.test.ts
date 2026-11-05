/** @vitest-environment jsdom */
import { expect, it, vi } from "vitest"
import { registerNavigationGuard, runAppNavigation } from "../navigation-guard"
it("waits for the active editor, rejects failed saves and drops superseded navigation", async () => {
  let finish!: (allow: boolean) => void
  const off = registerNavigationGuard(() => new Promise<boolean>(resolve => { finish = resolve }))
  const first = vi.fn(), second = vi.fn()
  const pending = runAppNavigation(first)
  expect(first).not.toHaveBeenCalled()
  finish(false); expect(await pending).toBe(false)
  const old = runAppNavigation(first), oldFinish = finish
  const latest = runAppNavigation(second)
  oldFinish(true); finish(true)
  expect(await old).toBe(false); expect(await latest).toBe(true)
  expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledOnce()
  off()
})
it("keeps unguarded navigation synchronous and stops a pending request when its editor is removed", async () => {
  const change = vi.fn(); const done = runAppNavigation(change)
  expect(change).toHaveBeenCalledOnce(); expect(await done).toBe(true)
  let finish!: (allow: boolean) => void
  const off = registerNavigationGuard(() => new Promise<boolean>(resolve => { finish = resolve }))
  const stale = runAppNavigation(change); off(); finish(true)
  expect(await stale).toBe(false); expect(change).toHaveBeenCalledOnce()
})

it("rejects navigation while an editor is busy without superseding its pending save-and-leave", async () => {
  let busy = false
  let finish!: (allow: boolean) => void
  const off = registerNavigationGuard(
    () => busy ? false : new Promise<boolean>(resolve => { finish = resolve }),
    () => busy,
  )
  const first = vi.fn(), second = vi.fn()
  try {
    const pending = runAppNavigation(first)
    busy = true
    expect(await runAppNavigation(second)).toBe(false)
    busy = false
    finish(true)
    expect(await pending).toBe(true)
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
  } finally { off() }
})
