/** @vitest-environment jsdom */
import { act } from "react"
import { expect, it, vi } from "vitest"
import { account, flush, mocks, mount } from "./harness"
import { MailSettings } from "../settings"
import { useMailAccounts } from "../use-mail-accounts"
import type { MailViewModel } from "../use-mail"
import type { AccountSummary } from "../../../../app-capabilities/mail/shared/types"

const configured: AccountSummary = {
  ...account, state: "connected", provider: "aliyun", aliases: [], notify: true,
  imap: { host: "imap.example.com", port: 993, security: "tls" },
  smtp: { host: "smtp.example.com", port: 465, security: "tls" },
  sentPolicy: "server", errorCode: null, capabilities: [],
}
const mail = { accounts: [configured], accountId: configured.id, folders: [], scope: null, selectAccount: vi.fn() } as unknown as MailViewModel
let model: ReturnType<typeof useMailAccounts>
function Harness() { model = useMailAccounts("user", () => undefined); return <MailSettings model={model} mail={mail} /> }

it("keeps a settings failure outside the scroll area and clears it when settings are corrected", async () => {
  mocks.api.accountUpdate = vi.fn().mockRejectedValue(new Error("无法保存邮箱设置，请重试"))
  mount(<Harness />); await flush()
  act(() => model.setSettingsOpen(true)); await flush()
  await act(async () => { await model.update(configured, { name: "工作" }) })
  const error = document.querySelector('[role="alert"]')!
  expect(error.textContent).toBe("无法保存邮箱设置，请重试")
  expect(error.closest('[data-slot="dialog-frame-footer"]')).not.toBeNull()
  const aliases = document.querySelector<HTMLInputElement>("#mail-settings-aliases")!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(aliases, "alias@example.com")
    aliases.dispatchEvent(new Event("input", { bubbles: true }))
  })
  expect(document.querySelector('[role="alert"]')).toBeNull()
})
