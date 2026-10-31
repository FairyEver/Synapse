/** @vitest-environment jsdom */
import { act, useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { mountGameRoot } from "../runtime/mount"
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
describe("独立入口重复加载", () => {
  it("Vite重新执行入口时复用根节点，不创建第二个React根或丢失当前操作状态", async () => {
    const host=document.createElement("div")
    document.body.append(host)
    const warn=vi.spyOn(console,"error")
    function Page(){ const [value,setValue]=useState(0);return <button onClick={()=>setValue(v=>v+1)}>{value}</button> }
    let root: ReturnType<typeof mountGameRoot>
    await act(async()=>{root=mountGameRoot(host,<Page />)})
    await act(async()=>host.querySelector("button")!.click())
    await act(async()=>expect(mountGameRoot(host,<Page />)).toBe(root!))
    expect(host.textContent).toBe("1")
    expect(warn).not.toHaveBeenCalled()
    await act(async()=>root!.unmount());host.remove();warn.mockRestore()
  })
})
