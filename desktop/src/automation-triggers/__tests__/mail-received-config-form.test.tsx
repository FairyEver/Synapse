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

it("edits optional senderMatches, subjectContains, and originalOnly filters without losing accountId", async () => {
  const changes = await render("ma_1")
  const senderInput = document.getElementById("automation-mail-sender-matches") as HTMLInputElement
  const subjectInput = document.getElementById("automation-mail-subject-contains") as HTMLInputElement
  const originalCheckbox = document.getElementById("automation-mail-original-only") as HTMLButtonElement
  expect(senderInput).toBeTruthy()
  expect(subjectInput).toBeTruthy()
  expect(originalCheckbox).toBeTruthy()

  const setInputValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!
  await act(async () => {
    setInputValue.call(senderInput, "@world-tech.com.cn, alice@example.com")
    senderInput.dispatchEvent(new Event("input", { bubbles: true }))
  })
  expect(changes).toHaveBeenLastCalledWith({
    accountId: "ma_1",
    senderMatches: ["@world-tech.com.cn", "alice@example.com"],
  })

  await act(async () => {
    setInputValue.call(subjectInput, "部署，上线")
    subjectInput.dispatchEvent(new Event("input", { bubbles: true }))
  })
  expect(changes).toHaveBeenLastCalledWith({
    accountId: "ma_1",
    subjectContains: ["部署", "上线"],
  })

  await act(async () => {
    originalCheckbox.click()
  })
  expect(changes).toHaveBeenLastCalledWith({
    accountId: "ma_1",
    originalOnly: true,
  })
})
