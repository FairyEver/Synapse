import { expect, it, vi } from "vitest"
import { mailIpcModule } from "../ipc"
import { MailContextProvider } from "../context"
import { MAIL_SERVICE_ID } from "../../shared/manifest"
it("uses the same core service from IPC and keeps credential configuration private", async () => {
  const context = new MailContextProvider(() => "server-user"), execute = vi.fn(async () => ({ items: [], nextCursor: null })), configure = vi.fn()
  const service = { context: (actor: import("../../shared/types").MailContext["actor"]) => context.current(actor), execute, configure }
  const response = await mailIpcModule.methods.accountList.handler({ moduleId: "mail", resolve: <T>(id: string) => { expect(id).toBe(MAIL_SERVICE_ID); return service as T } }, {})
  expect(response).toMatchObject({ ok: true, data: { items: [] } }); expect(execute).toHaveBeenCalledTimes(1)
  expect(mailIpcModule.methods.accountConfigure.operationId).toBe("app.mail.account.configure")
  expect(mailIpcModule.methods.accountConfigure.request.safeParse({ ownerId: "forged", credential: "secret" }).success).toBe(false)
})
