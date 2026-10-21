import { describe, expect, it, vi } from "vitest"
import type { IpcHandlerContext } from "../../../runtime/ipc/types"
const mocks = vi.hoisted(() => ({ resolve: vi.fn() }))
vi.mock("../ipc-shared", () => ({ resolveProjectAgent: mocks.resolve }))
import { generatedUiMethods } from "../ipc-generated-ui"

const target = { projectId: "project-1", conversationId: "conversation-1", blockId: "12345678-1234-4234-8234-123456789012" }
describe("generated UI private IPC", () => {
  it("rejects privileged fields and requires source identity and bounded state", () => {
    const schema = generatedUiMethods.getGeneratedUiState.request
    expect(schema.safeParse(target).success).toBe(true)
    expect(schema.safeParse({ ...target, cwd: "/untrusted" }).success).toBe(false)
    expect(generatedUiMethods.saveGeneratedUiState.request.safeParse({ ...target, expectedRevision: 0, state: { text: "x".repeat(70 * 1024) } }).success).toBe(false)
  })
  it("refuses non-renderer callers and binds submissions to the sender's ownership", async () => {
    const agent = { getGeneratedUiState: vi.fn(), setRendererSubscription: vi.fn(), submitGeneratedUiAction: vi.fn().mockResolvedValue({ submissionId: target.blockId, status: "accepted" }) }
    mocks.resolve.mockResolvedValue({ agent })
    const ctx = { resolve: vi.fn() } as unknown as IpcHandlerContext
    await expect(generatedUiMethods.getGeneratedUiState.handler(ctx, target)).rejects.toThrow("本地")
    const senderCtx = { ...ctx, sender: { id: 42 } } as IpcHandlerContext
    const input = { ...target, submissionId: target.blockId, expectedRevision: 0, message: "查询", formState: { days: "7" } }
    await generatedUiMethods.submitGeneratedUiAction.handler(senderCtx, input)
    expect(agent.submitGeneratedUiAction).toHaveBeenCalledWith(input, 42)
    expect(agent.setRendererSubscription).not.toHaveBeenCalled()
  })
})
