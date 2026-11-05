// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { MailReceivedConfigForm } from "../../../automation-trigger-packages/builtin/mail-received/config.renderer"
import type { SynapseBridge } from "../../types/bridge"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
afterEach(async () => { await act(async () => root?.unmount()); document.body.innerHTML = ""; delete (window as unknown as { synapse?: unknown }).synapse })
async function render(accountId?: string, fail = false) {
  if (root) await act(async () => root!.unmount())
  const changes = vi.fn()
  const bridge = { mail: { uiScope: async () => ({ ownerId: "owner", generation: 1 }), accountList: async () => { if (fail) throw new Error("offline"); return { items: [], nextCursor: null } }, onChanged: () => () => undefined }, account: { state: { onChanged: () => () => undefined } } }
  Object.assign(window, { synapse: bridge as unknown as SynapseBridge })
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  await act(async () => root!.render(<MailReceivedConfigForm value={accountId ? { accountId } : {}} onChange={changes} />))
  return changes
}
it("keeps a saved missing account and reports it without falling back to all accounts", async () => {
  const changes = await render("removed-account")
  expect(document.body.textContent).toContain("邮箱账号不可用")
  expect(changes).not.toHaveBeenCalled()
})
it("shows all accounts by default and preserves a configured account when loading fails", async () => {
  await render(undefined)
  expect(document.body.textContent).toContain("全部邮箱账号")
  await render("saved", true)
  expect(document.body.textContent).toContain("账号加载失败")
})
