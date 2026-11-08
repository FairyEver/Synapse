// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { openTerminalSession } from "../open-terminal-session"
import { subscribeOpenTerminalSession } from "@/app-shell/terminal-navigation"

const sessionGet = vi.fn()
const groupList = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  sessionGet.mockResolvedValue({ id: "s1", groupId: "g1", status: "running" })
  groupList.mockResolvedValue([{ id: "g1", projectId: "p1" }])
  window.synapse = { terminal: { session: { get: sessionGet }, group: { list: groupList } } } as unknown as typeof window.synapse
})

describe("open an automation's existing terminal", () => {
  it("opens the exact validated session only when requested", async () => {
    const navigate = vi.fn()
    const unsubscribe = subscribeOpenTerminalSession(navigate)
    try {
      expect(navigate).not.toHaveBeenCalled()
      await openTerminalSession({ projectId: "p1", sessionId: "s1" })
      expect(navigate).toHaveBeenCalledWith({ requestId: expect.any(String), sessionId: "s1" })
    } finally { unsubscribe() }
  })
  it("reports missing or mismatched sessions without navigation or creation", async () => {
    const navigate = vi.fn()
    const unsubscribe = subscribeOpenTerminalSession(navigate)
    try {
      sessionGet.mockRejectedValueOnce(new Error("deleted"))
      await expect(openTerminalSession({ projectId: "p1", sessionId: "s1" })).rejects.toThrow("终端会话已不可用")
      await expect(openTerminalSession({ projectId: "other", sessionId: "s1" })).rejects.toThrow("终端会话已不可用")
      expect(navigate).not.toHaveBeenCalled()
    } finally { unsubscribe() }
  })
  it("opens a retained global session without requiring a project", async () => {
    sessionGet.mockResolvedValueOnce({ id: "s1", groupId: "global", status: "ENDED" })
    groupList.mockResolvedValueOnce([{ id: "global" }])
    const navigate = vi.fn()
    const unsubscribe = subscribeOpenTerminalSession(navigate)
    try {
      await openTerminalSession({ sessionId: "s1" })
      expect(navigate).toHaveBeenCalledWith({ requestId: expect.any(String), sessionId: "s1" })
    } finally { unsubscribe() }
  })
  it("rejects a wrong session ID or missing group for global sessions", async () => {
    const navigate = vi.fn()
    const unsubscribe = subscribeOpenTerminalSession(navigate)
    try {
      sessionGet.mockResolvedValueOnce({ id: "other", groupId: "g1" })
      await expect(openTerminalSession({ sessionId: "s1" })).rejects.toThrow("终端会话已不可用")
      groupList.mockResolvedValueOnce([])
      await expect(openTerminalSession({ sessionId: "s1" })).rejects.toThrow("终端会话已不可用")
      expect(navigate).not.toHaveBeenCalled()
    } finally { unsubscribe() }
  })
})
