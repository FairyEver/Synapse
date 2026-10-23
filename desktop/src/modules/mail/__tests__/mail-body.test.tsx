/** @vitest-environment jsdom */
import { mocks, mount, flush, detail } from "./harness"
import { act } from "react"
import { expect, it, vi } from "vitest"
import { useMailBody } from "../use-mail-body"

for (const code of ["STALE_TARGET", "BODY_UNAVAILABLE", "NETWORK_TIMEOUT"]) it(`closes an invalidated reading only for ${code}`, async () => {
  mocks.api.bodyReadChunk.mockRejectedValue(Object.assign(new Error("Unavailable"), { code }))
  const invalidated = vi.fn()
  let current!: ReturnType<typeof useMailBody>
  function Harness() { current = useMailBody(detail, "user", invalidated); return null }
  mount(<Harness />); await flush()
  expect(current.body).toBeNull()
  expect(current.error).toBe("Unavailable")
  expect(invalidated).toHaveBeenCalledTimes(code === "STALE_TARGET" ? 1 : 0)
})

it("ignores a late invalidation from the previously selected message", async () => {
  let reject!: (error: unknown) => void
  mocks.api.bodyReadChunk.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
  const invalidated = vi.fn()
  let current!: ReturnType<typeof useMailBody>
  function Harness({ message = detail }) { current = useMailBody(message, "user", invalidated); return null }
  mount(<Harness />); await flush()
  mount(<Harness message={{ ...detail, id: "em_two" }} />); await flush()
  await act(async () => { reject(Object.assign(new Error("Old message removed"), { code: "STALE_TARGET" })); await Promise.resolve() })
  expect(current.body?.text).toBe("正文")
  expect(current.error).toBeNull()
  expect(invalidated).not.toHaveBeenCalled()
})
