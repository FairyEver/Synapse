/** @vitest-environment jsdom */
import { mocks, mount, flush, detail, summary } from "./harness"
import { act } from "react"
import { expect, it } from "vitest"
import { MailDetail } from "../message-detail"
import { useMail } from "../use-mail"
let current: ReturnType<typeof useMail>
function Harness() { current = useMail(); return null }
it("preserves individual restore results and ignores old identity events", async () => {
  mount(<Harness />); await flush()
  mocks.api.messageRestore.mockResolvedValue({ items: [{ id: summary.id, status: "unknown", code: "UNCONFIRMED" }] })
  let result: unknown
  await act(async () => { result = await current.mutate("restore", [summary.id]) })
  expect(result).toMatchObject({ items: [{ status: "unknown" }] })
  const calls = mocks.api.messageList.mock.calls.length
  act(() => mocks.changed({ ownerId: "other", generation: 1, accountId: "ma_one", ids: [], revision: 1 })); await flush()
  expect(mocks.api.messageList).toHaveBeenCalledTimes(calls)
})
it("uses a fixed sandbox for cleaned complete HTML and provides a back action", () => {
  const back = () => undefined
  mount(<MailDetail detail={detail} body={{ html: "<p>hello<script>alert(1)</script><img src='https://private/x'></p>", text: "hello", complete: true, truncated: false }} resources={{ cid: {}, remote: {} }} onBack={back} onResource={() => undefined} onDownload={() => undefined} onLink={() => undefined} onReply={() => undefined} onCopy={() => undefined} />)
  const iframe = document.querySelector("iframe")!
  expect(iframe.getAttribute("sandbox")).toBe("allow-same-origin")
  expect(iframe.getAttribute("srcdoc")).not.toContain("<script")
  expect(iframe.getAttribute("srcdoc")).toContain("default-src 'none'")
  expect(document.querySelector('button[aria-label="返回邮件列表"]')).toBeTruthy()
})
