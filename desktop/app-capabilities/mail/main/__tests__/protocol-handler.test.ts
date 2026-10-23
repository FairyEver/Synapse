import { expect, it, vi } from "vitest"
import { createMailProtocolHandlers } from "../protocol-handler"
import { MAIL_OPEN_HANDLER } from "../../shared/manifest"
it("validates canonical links and owned targets before focusing a window", async () => {
  const openMessage = vi.fn(), service = { openMessage }
  const handlers = createMailProtocolHandlers({ get: <T>() => service as T })
  for (const deepLink of ["synapse://mail/old-internal-id", "synapse://mail-internal/cm123", "synapse://mail/em_e69940c0-4db1-4a0a-8f87-9027d116e194?extra=1"]) await expect(handlers[MAIL_OPEN_HANDLER]({ deepLink })).rejects.toThrow()
  expect(openMessage).not.toHaveBeenCalled()
  await handlers[MAIL_OPEN_HANDLER]({ deepLink: "synapse://mail/em_e69940c0-4db1-4a0a-8f87-9027d116e194" })
  expect(openMessage).toHaveBeenCalledWith("em_e69940c0-4db1-4a0a-8f87-9027d116e194")
})
