import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness"
import { isSafeAwarenessState, removeAwarenessClients } from "./drive-collaboration.gateway"

describe("Drive collaboration awareness validation", () => {
  const relativePosition = {
    type: null,
    tname: "content",
    item: { client: 12, clock: 4 },
    assoc: 0,
  }

  it("accepts only the Monaco identity and relative selection shape", () => {
    expect(isSafeAwarenessState({
      user: { name: "协作者 1234", color: "var(--primary)", colorLight: "var(--accent)" },
      selection: { anchor: relativePosition, head: { ...relativePosition, item: null } },
    })).toBe(true)
  })

  it("rejects document, comment, and identity data hidden in selections", () => {
    expect(isSafeAwarenessState({ selection: { anchor: relativePosition, head: relativePosition, body: "secret" } })).toBe(false)
    expect(isSafeAwarenessState({ selection: { anchor: { ...relativePosition, email: "reader@example.com" }, head: relativePosition } })).toBe(false)
    expect(isSafeAwarenessState({ user: { name: "reader", email: "reader@example.com" } })).toBe(false)
  })

  it("produces a removal update when a collaboration connection leaves", () => {
    const client = new Awareness(new Y.Doc())
    const server = new Awareness(new Y.Doc())
    const observer = new Awareness(new Y.Doc())
    client.setLocalStateField("user", { name: "协作者 1234" })
    const clientId = client.doc.clientID
    const joined = encodeAwarenessUpdate(client, [clientId])
    applyAwarenessUpdate(server, joined, "join")
    applyAwarenessUpdate(observer, joined, "join")

    const removal = removeAwarenessClients(server, [clientId], "disconnect")
    applyAwarenessUpdate(observer, removal, "server")

    expect(server.getStates().has(clientId)).toBe(false)
    expect(observer.getStates().has(clientId)).toBe(false)
    client.destroy()
    server.destroy()
    observer.destroy()
  })
})
