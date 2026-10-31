/** @vitest-environment jsdom */
import { act, useState } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
const EmbeddedSystemAppShell = ({children}: {children: import("react").ReactNode; appName?: string; mode?: string}) => <>{children}</>
import { PokerApp } from "../PokerApp"
import { SystemAppWindowShell } from "@/game-center/runtime/page-shell"

vi.mock("@/game-center/runtime/account", () => ({useAccount: () => ({state:{status:"authenticated",profile:{user:{id:"user"}}}})}))
vi.mock("../components/Lobby", () => ({ Lobby: () => <div>房间内容</div> }))
vi.mock("../components/HandRecord", () => ({ HandRecord: () => <div>记录内容</div> }))
vi.mock("../components/AgentProfiles", () => ({ AgentProfiles: () => <div>档案内容</div> }))
vi.mock("../hooks/usePokerRoom", () => ({
  usePokerRoom: (roomCode: string) => ({
    table: { roomCode },
    perspective: "owner",
    setPerspective: vi.fn(),
  }),
}))
vi.mock("../hooks/usePokerEvents", () => ({ usePokerEvents: () => ({ events: [], animate: [] }) }))
vi.mock("../hooks/usePracticeBots", () => ({ usePracticeBots: () => ({ canManage: false }) }))
vi.mock("../components/Table", () => ({
  Table: ({ table }: { table: { roomCode: string } }) => <div>牌桌 {table.roomCode}</div>,
}))
vi.mock("../../../hooks/useGameQuery", () => ({ useGameMutation: vi.fn() }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => document.body.replaceChildren())
describe("游戏应用顶栏", () => {
  it("切换沉浸模式保留子页面的牌桌导航状态", async () => {
    function Page() {
      const [open,setOpen]=useState(false)
      return <SystemAppWindowShell immersive={open}><button onClick={()=>setOpen(value=>!value)}>{open ? "返回房间" : "进入牌桌"}</button></SystemAppWindowShell>
    }
    const host=document.createElement("div"),root=createRoot(host)
    await act(async()=>root.render(<EmbeddedSystemAppShell appName="游戏"><Page /></EmbeddedSystemAppShell>))
    const enter=[...host.querySelectorAll("button")].find(button=>button.textContent==="进入牌桌")!
    await act(async()=>enter.click())
    expect(host.textContent).toContain("返回房间")
    expect(host.querySelector('.game-web-header')).toBeNull()
    await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click())
    expect(host.textContent).toContain("进入牌桌")
    expect(host.querySelector('.game-web-header')).not.toBeNull()
    await act(async()=>root.unmount())
  })
  it("启动台内进入牌桌也隐藏应用顶栏并声明沉浸状态", async () => {
    const host=document.createElement("div"),root=createRoot(host)
    await act(async()=>root.render(<EmbeddedSystemAppShell appName="游戏"><PokerApp roomCode="4821" onOpenRoom={vi.fn()} onBack={vi.fn()} /></EmbeddedSystemAppShell>))
    expect(host.querySelector('.game-web-header')).toBeNull()
    expect(host.querySelector('[data-game-immersive="true"]')).not.toBeNull()
    await act(async()=>root.unmount())
  })
  it.each(["牌局记录", "选手档案"])("从%s收到房间深链后切回牌桌", async (label) => {
    const host = document.createElement("div"),
      root = createRoot(host),
      onOpenRoom = vi.fn(),
      onBack = vi.fn()
    document.body.append(host)
    await act(async () =>
      root.render(<PokerApp roomCode={null} onOpenRoom={onOpenRoom} onBack={onBack} />),
    )
    const target = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (tab) => tab.textContent === label,
    )!
    await act(async () =>
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })),
    )
    expect(host.textContent).toContain(label === "牌局记录" ? "记录内容" : "档案内容")
    await act(async () =>
      root.render(<PokerApp roomCode="4821" onOpenRoom={onOpenRoom} onBack={onBack} />),
    )
    expect(host.textContent).toContain("牌桌 4821")
    expect(host.querySelector('[role="tab"]')).toBeNull()
    await act(async () => root.unmount())
  })

  it.each(["window", "dock", "launcher"] as const)(
    "%s 模式只显示统一顶栏和一个返回大厅入口",
    async (mode) => {
      const host = document.createElement("div"),
        root = createRoot(host)
      document.body.append(host)
      const onBack = vi.fn(),
        onOpenRoom = vi.fn()
      const page = <PokerApp roomCode={null} onOpenRoom={onOpenRoom} onBack={onBack} />
      await act(async () =>
        root.render(
          mode === "window" ? (
            page
          ) : (
            <EmbeddedSystemAppShell appName="游戏" mode={mode}>
              {page}
            </EmbeddedSystemAppShell>
          ),
        ),
      )
      const headers = host.querySelectorAll(".game-web-header")
      expect(headers).toHaveLength(1)
      const header = headers[0]
      if (mode === "window")
        expect(header.querySelector(".game-web-header-title")?.textContent).toBe("德州扑克")
      expect([...header.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([
        "房间",
        "牌局记录",
        "选手档案",
      ])
      const returns = [...header.querySelectorAll("button")].filter((button) =>
        /^(返回大厅|游戏)$/.test(button.textContent ?? ""),
      )
      expect(returns).toHaveLength(1)
      expect(returns[0].closest(".game-web-header-actions")).not.toBeNull()
      await act(async () => returns[0].click())
      expect(onBack).toHaveBeenCalledOnce()
      const records = header.querySelector<HTMLButtonElement>(
        '[role="tab"][data-state="inactive"]',
      )!
      await act(async () =>
        records.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })),
      )
      expect(host.textContent).toContain("记录内容")
      expect(onOpenRoom).toHaveBeenCalledWith(null)
      expect(host.textContent).not.toMatch(/切换深色|切换浅色|查看大厅|房间列表|2 人|6 人|10 人/)
      await act(async () => root.unmount())
    },
  )
})
