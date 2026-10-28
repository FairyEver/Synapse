import { createContext, runInContext } from "node:vm"
import { Readable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { appendDriveHistoryRestoreScript, buildDriveHistoryRestoreScript } from "./drive-history-restore"

describe("raw HTML browsing history restoration", () => {
  it("records only persisted top-level restores with a fresh ID for every restore", async () => {
    const script = buildDriveHistoryRestoreScript({ kind: "share", shareId: "public", itemId: "child" })
    const listeners: Record<string, (event: { persisted: boolean }) => void> = {}
    const fetch = vi.fn(async (_url: string, _options: RequestInit) => ({ ok: true }))
    const window: Record<string, unknown> = { addEventListener: (name: string, handler: typeof listeners[string]) => { listeners[name] = handler } }
    window.self = window; window.top = window
    let counter = 0
    runInContext(script.source, createContext({ window, fetch, crypto: { randomUUID: () => `visit-${++counter}` } }))
    listeners.pageshow!({ persisted: false })
    expect(fetch).not.toHaveBeenCalled()
    listeners.pageshow!({ persisted: true }); listeners.pageshow!({ persisted: true })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string))).toEqual([{ visitId: "visit-1" }, { visitId: "visit-2" }])
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/drive/browser/shares/public/items/child/visits")
    const iframe = { ...window, top: {} }
    const addEventListener = vi.fn()
    runInContext(script.source, createContext({ window: { ...iframe, addEventListener }, fetch }))
    expect(addEventListener).not.toHaveBeenCalled()
  })

  it("retries a failed restore with the same UUID and logs exhausted failures without metadata", async () => {
    const script = buildDriveHistoryRestoreScript({ kind: "share", shareId: "public" })
    let pageshow: ((event: { persisted: boolean }) => void) | undefined
    const fetch = vi.fn(async (_url: string, _options: RequestInit) => ({ ok: true }))
      .mockResolvedValueOnce({ ok: false }).mockRejectedValueOnce(new Error("private details"))
    const warn = vi.fn()
    const window: Record<string, unknown> = { addEventListener: (_name: string, handler: typeof pageshow) => { pageshow = handler } }
    window.self = window; window.top = window
    runInContext(script.source, createContext({ window, fetch, console: { warn }, crypto: { randomUUID: () => "same-visit" } }))
    pageshow!({ persisted: true })
    await new Promise(setImmediate)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls.map((call) => JSON.parse(call[1].body as string).visitId)).toEqual(["same-visit", "same-visit"])
    expect(warn).toHaveBeenCalledWith({ event: "drive.browsing-history.restore.failed" })
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private details")
  })

  it("escapes inline script boundaries and sends only a Site's validated relative path", () => {
    const script = buildDriveHistoryRestoreScript({ kind: "site", siteId: "site", relativePath: "</script>/index.html" })
    expect(script.html.match(/<\/script>/gu)).toHaveLength(1)
    expect(script.source).not.toContain("</script>")
    expect(script.cspHash).toMatch(/^sha256-/u)
  })

  it("appends without changing BOM, doctype or binary chunk boundaries, and forwards source failures", async () => {
    const original = Buffer.from("\ufeff<!doctype html><html>内容</html>")
    const script = buildDriveHistoryRestoreScript({ kind: "share", shareId: "public" })
    const chunks: Buffer[] = []
    for await (const chunk of appendDriveHistoryRestoreScript(Readable.from([original.subarray(0, 1), original.subarray(1, 5), original.subarray(5)]), script)) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks)).toEqual(Buffer.concat([original, Buffer.from(script.html)]))
    const broken = new Readable({ read() { this.destroy(new Error("source failed")) } })
    await expect((async () => { for await (const _chunk of appendDriveHistoryRestoreScript(broken, script)) { /* Consume the stream. */ } })()).rejects.toThrow("source failed")
  })
})
