import "@/styles/globals.css"
import "../../../styles/web.css"
import { expect, it, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"
import { SystemAppTopBarActionButton, SystemAppWindowShell } from "../../../runtime/page-shell"
import { LobbyView } from "../components/LobbyView"
import { RoomList } from "../components/RoomList"
import { MySessions } from "../../../components/MySessions"

it.each([320, 390, 850, 851, 1280])("%spx 房间入口完整显示导航、房间和操作", async width => {
  await page.viewport(width, 844)
  const onRoom = vi.fn(), onConnect = vi.fn(), onClose = vi.fn()
  const name = "移动端房间".repeat(12)
  const screen = await render(<SystemAppWindowShell left="德州扑克" tabs={[{id:"rooms",label:"房间"},{id:"records",label:"牌局记录"},{id:"agents",label:"选手档案"}]} value="rooms" actions={<SystemAppTopBarActionButton onClick={vi.fn()}>返回大厅</SystemAppTopBarActionButton>}>
    <div className="game-hall h-full min-h-0 bg-background text-foreground"><div className="game-center h-full min-h-0 overflow-y-auto overscroll-contain">
      <LobbyView rooms={[
        {roomCode:"123456",name,mode:"practice",ownerUserId:"other",maxSeats:6,players:4,status:"running",buyIn:50000,smallBlind:5,bigBlind:10},
        {roomCode:"654321",mode:"points",ownerUserId:"owner",maxSeats:6,players:2,status:"waiting",buyIn:1000,smallBlind:1,bigBlind:2},
      ]} sessions={[{game:"poker",gameName:"德州扑克",roomCode:"123456",funding:"practice",status:"active",seatNo:0,needsAction:true,deadlineMs:20000}]} userId="owner" onRoom={onRoom} onCreate={vi.fn()} onConnect={onConnect} onClose={onClose} />
    </div></div>
  </SystemAppWindowShell>)
  try {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    await page.screenshot({path:`.superpowers/poker-mobile/lobby-${width}.png`})
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    for (const element of document.querySelectorAll('button, [role="tab"], .game-room-table')) {
      if (!element.getClientRects().length) continue
      const bounds = element.getBoundingClientRect()
      expect(bounds.left).toBeGreaterThanOrEqual(0)
      expect(bounds.right, element.textContent ?? "").toBeLessThanOrEqual(width)
    }
    if (width <= 850) {
      // A compact record must present one continuous surface, without table-cell blocks.
      expect([...document.querySelectorAll("table")].filter(element => element.getClientRects().length)).toHaveLength(0)
    }
    await page.getByRole("button", {name, exact:true}).click()
    expect(onRoom).toHaveBeenCalledExactlyOnceWith("123456")
    await page.getByRole("button", {name:"继续游戏 #123456"}).click()
    expect(onRoom.mock.calls).toEqual([["123456"], ["123456"]])
    await page.getByRole("button", {name:"接入 AI", exact:true}).click()
    expect(onConnect).toHaveBeenCalledExactlyOnceWith("654321")
    await page.getByRole("button", {name:"解散", exact:true}).click()
    expect(onClose).toHaveBeenCalledExactlyOnceWith("654321")
    expect(onRoom).toHaveBeenCalledTimes(2)
  } finally { await screen.unmount() }
})

it.each([850, 851])("桌面中的 %spx 内容区按自身宽度切换列表", async width => {
  await page.viewport(1280, 844)
  const screen = await render(<div style={{width}}><RoomList rooms={[{roomCode:"123456",ownerUserId:"owner",maxSeats:6,players:4,status:"running",buyIn:1000,smallBlind:5,bigBlind:10}]} myRoomCodes={[]} userId="owner" onRoom={vi.fn()} onConnect={vi.fn()} onClose={vi.fn()} /></div>)
  try {
    if (width === 850) {
      await expect.element(page.getByRole("list", {name:"房间列表"})).toBeVisible()
      await expect.element(page.getByRole("grid", {name:"房间列表"})).not.toBeInTheDocument()
    } else {
      await expect.element(page.getByRole("grid", {name:"房间列表"})).toBeVisible()
      await expect.element(page.getByRole("list", {name:"房间列表"})).not.toBeInTheDocument()
    }
  } finally { await screen.unmount() }
})

it("窄屏大厅没有进行中会话时保留空态提示", async () => {
  await page.viewport(390, 844)
  const screen = await render(<MySessions sessions={[]} onOpen={vi.fn()} />)
  try {
    const list = document.querySelector<HTMLElement>(".game-compact-list")!
    await expect.element(list).toBeVisible()
    expect(list.textContent).toContain("暂无进行中的游戏")
  } finally { await screen.unmount() }
})
