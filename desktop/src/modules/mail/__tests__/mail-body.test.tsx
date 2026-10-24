/** @vitest-environment jsdom */
import { mocks, mount, flush, detail } from "./harness"
import { act } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { useMailBody } from "../use-mail-body"

afterEach(() => vi.unstubAllGlobals())

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

it("keeps successful images around a failure and clears the error on a successful retry", async () => {
  mocks.api.imageRemote = vi.fn().mockResolvedValueOnce({ token: "first" }).mockRejectedValueOnce(new Error("图片不可用")).mockResolvedValueOnce({ token: "last" }).mockResolvedValueOnce({ token: "retry" })
  mocks.api.imageRead = vi.fn().mockResolvedValue({ base64: "iVBORw0KGgo=", mime: "image/png" })
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn().mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:last").mockReturnValueOnce("blob:retry")
    static revokeObjectURL = vi.fn()
  })
  let current!: ReturnType<typeof useMailBody>
  function Harness() { current = useMailBody(detail, "user"); return null }
  mount(<Harness />); await flush()
  await act(async () => { await current.loadRemote(["https://a.example/1", "https://a.example/2", "https://a.example/3"]) })
  expect(current.resources.remote).toEqual({ "https://a.example/1": "blob:first", "https://a.example/3": "blob:last" })
  expect(current.error).toBe("1 张图片加载失败：图片不可用")
  await act(async () => { await current.loadRemote(["https://a.example/1", "https://a.example/2", "https://a.example/3"]) })
  expect(mocks.api.imageRemote).toHaveBeenCalledTimes(4)
  expect(current.resources.remote).toEqual({ "https://a.example/1": "blob:first", "https://a.example/2": "blob:retry", "https://a.example/3": "blob:last" })
  expect(current.error).toBeNull()
  expect(current.loading).toBe(false)
})

it("stops the remaining image requests when the message changes during a failed request", async () => {
  let reject!: (error: Error) => void
  mocks.api.imageRemote = vi.fn().mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
  let current!: ReturnType<typeof useMailBody>
  function Harness({ message = detail }) { current = useMailBody(message, "user"); return null }
  mount(<Harness />); await flush()
  let loading!: Promise<void>
  act(() => { loading = current.loadRemote(["https://a.example/1", "https://a.example/2"]) })
  mount(<Harness message={{ ...detail, id: "em_two" }} />); await flush()
  await act(async () => { reject(new Error("Old request failed")); await loading })
  expect(mocks.api.imageRemote).toHaveBeenCalledTimes(1)
  expect(current.error).toBeNull()
  expect(current.resources.remote).toEqual({})
})

it("publishes a completed image while a later request is still pending and ignores duplicate clicks", async () => {
  let finish!: (value: { token: string }) => void
  mocks.api.imageRemote = vi.fn().mockResolvedValueOnce({ token: "first" }).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  mocks.api.imageRead = vi.fn().mockResolvedValue({ base64: "iVBORw0KGgo=", mime: "image/png" })
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn().mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second")
    static revokeObjectURL = vi.fn()
  })
  let current!: ReturnType<typeof useMailBody>
  function Harness() { current = useMailBody(detail, "user"); return null }
  mount(<Harness />); await flush()
  let loading!: Promise<void>
  act(() => { loading = current.loadRemote(["https://a.example/1", "https://a.example/2"]) }); await flush()
  expect(current.resources.remote).toEqual({ "https://a.example/1": "blob:first" })
  expect(current.loading).toBe(true)
  await act(async () => { await current.loadRemote(["https://a.example/2"]) })
  expect(mocks.api.imageRemote).toHaveBeenCalledTimes(2)
  await act(async () => { finish({ token: "second" }); await loading })
  expect(current.resources.remote).toEqual({ "https://a.example/1": "blob:first", "https://a.example/2": "blob:second" })
  expect(current.loading).toBe(false)
})
