import "@/styles/globals.css"
import "../../../styles/web.css"
import { useRef, useState } from "react"
import { Button } from "@heroui/react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "vitest-browser-react"
import { CreateRoomDialog } from "../components/CreateRoomDialog"
import { PokerAIConnectDialog } from "../components/PokerAIConnectDialog"
import { PokerMembersPanel } from "../components/PokerMembersPanel"
import { PracticeBots } from "../components/PracticeBots"
import { PokerRollDialog } from "../components/PokerRollDialog"
import { PokerPlayerInfoDialog } from "../components/PokerPlayerInfoDialog"
import { PokerRollFeeDialog } from "../components/PokerRollFeeDialog"
import { PokerPotSourcesDialog } from "../components/PokerPotSourcesDialog"
import { HandRankDialog } from "../components/HandRankDialog"
import { SettlementPanel } from "../components/SettlementPanel"
import { PokerMatchOverviewDialog } from "../components/PokerMatchOverviewDialog"
import { PracticePreparation } from "../components/PracticePreparation"
import { PersonaBadge } from "../components/PersonaBadge"
import { rollTable } from "./roll-visibility-fixtures"
import { feeLedger } from "./roll-fee-fixtures"
import { table as settled } from "./settlement-fixture"

vi.mock("../../../lib/api", () => ({ gameApi: () => ({ poker: { table: { state: vi.fn() } } }) }))
vi.mock("@/game-center/runtime/account", () => ({ useAccount: () => ({ state: { status: "authenticated", connectivity: "online", profile: { user: { id: "owner" } } } }) }))
const longName = "LongUnbrokenPlayerName".repeat(15)
const large = 2147483647
const stress: PokerTableView = {
  ...rollTable,
  seats: rollTable.seats.map((seat, index) => ({ ...seat, displayName: `${index}-${longName}`, participantKind: index ? "bot" : "human", botId: index ? `bot-${index}` : undefined, stack: large })),
  rollLedger: { ...feeLedger, players: feeLedger.players.map(player => ({ ...player, displayName: `${player.key}-${longName}` })) },
  roll: { ...rollTable.roll!, count: 1000000, normal: { fee: large, available: true }, super: { fee: large, available: true } },
  potContributions: { handId: rollTable.handId!, status: "pending", total: large * feeLedger.players.length, players: feeLedger.players.map(player => ({ ...player, displayName: `${player.key}-${longName}`, amount: large })) },
}
const controls = { canManage: true, busy: false, full: false, retrying: false, bots: stress.seats.slice(1), add: vi.fn(), remove: vi.fn() }
const rollControls = { blocked: false, storageError: null, canControl: true, busy: false, uncertain: false, continuation: null, error: null, start: vi.fn(), choose: vi.fn(), retry: vi.fn() }
const panelNames = ["create", "ai", "members", "roll", "candidates", "player", "fees", "pot", "ranks", "settlement"] as const
function Fixture({ name }: { name: typeof panelNames[number] }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const close = () => setOpen(false)
  const pending = { ...stress, roll: { ...stress.roll!, pending: { rollId: "pending", cardIndex: 1, candidates: ["2c", "3c", "4c"] } } }
  return <>
    <Button ref={trigger} onPress={() => setOpen(true)}>打开测试面板</Button>
    {name === "create" && <CreateRoomDialog open={open} onOpenChange={setOpen} value={{ name: longName, mode: "practice", variant: "short32", blindPreset: "10/20", maxSeats: 10, roll: true, rollCoins: 12, buyIn: 1000 }} onChange={vi.fn()} onCreate={vi.fn()} busy={false} />}
    {name === "ai" && <PokerAIConnectDialog open={open} onOpenChange={setOpen} roomCode={stress.roomCode} table={stress} onChanged={vi.fn()} />}
    {name === "members" && <PokerMembersPanel open={open} onOpenChange={setOpen} compact trigger={trigger} container={null}><PracticeBots controls={controls} table={stress} /></PokerMembersPanel>}
    {(name === "roll" || name === "candidates") && <PokerRollDialog table={name === "candidates" ? pending : stress} open={open} onOpenChange={setOpen} controls={rollControls} disabled={false} epoch="test" onTakeover={vi.fn()} />}
    {open && name === "player" && <PokerPlayerInfoDialog table={stress} seat={stress.seats[1]} onClose={close} />}
    {open && name === "fees" && <PokerRollFeeDialog table={stress} onClose={close} />}
    {open && name === "pot" && <PokerPotSourcesDialog table={stress} onClose={close} />}
    {name === "ranks" && <HandRankDialog open={open} onOpenChange={setOpen} compact />}
    {name === "settlement" && <SettlementPanel table={{ ...settled, settlement: { ...settled.settlement!, seats: stress.seats.map((seat, index) => ({ ...settled.settlement!.seats[index ? 1 : 0], seatNo: index, displayName: seat.displayName, delta: index ? -large : large, payout: index ? 0 : large, endingStack: large })) } }} perspective="owner" onRefresh={vi.fn()} ready={{ canReady: true, canTakeover: false, prepared: false, busy: false, error: null, ready: vi.fn(), takeover: vi.fn(), refresh: vi.fn() }} />}
  </>
}
const rect = (element: Element) => element.getBoundingClientRect()
function fits(element: Element, label: string) {
  const box = rect(element)
  expect(box.left, `${label} left`).toBeGreaterThanOrEqual(-1)
  expect(box.right, `${label} right`).toBeLessThanOrEqual(innerWidth + 1)
  expect(box.top, `${label} top`).toBeGreaterThanOrEqual(-1)
  expect(box.bottom, `${label} bottom`).toBeLessThanOrEqual(innerHeight + 1)
}
for (const [width, height] of [[320,568],[390,667],[568,320],[667,320],[1280,800]]) {
  for (const name of panelNames) it(`${width}×${height} ${name} preserves scroll, footer, close and focus`, async () => {
    await page.viewport(width,height)
    const screen = await render(<Fixture name={name} />)
    try {
      if (name !== "settlement") await page.getByRole("button", {name:"打开测试面板",exact:true}).click()
      await expect.element(page.getByRole("dialog")).toBeVisible()
      await new Promise(resolve => setTimeout(resolve,350))
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
      const body = dialog.querySelector<HTMLElement>('.modal__body,.drawer__body')!
      const footer = dialog.querySelector<HTMLElement>('.modal__footer,.drawer__footer')!
      fits(dialog, name)
      await page.screenshot({path:`.superpowers/sdd/2026-11-02-mobile-panels/${width}-${height}-${name}.png`})
      expect(dialog.scrollWidth, `${name} dialog overflow`).toBeLessThanOrEqual(dialog.clientWidth + 1)
      expect(body.scrollWidth, `${name} body overflow`).toBeLessThanOrEqual(body.clientWidth + 1)
      expect(body.clientHeight, `${name} positive scroll viewport`).toBeGreaterThan(24)
      if (name === "candidates" && height === 320) expect(body.clientHeight).toBeGreaterThanOrEqual(80)
      if (name === "settlement" && width <= 390) {
        for (const value of body.querySelectorAll('.poker-result-money dd')) {
          expect(rect(value).height, 'large settlement amount stays on one line').toBeLessThanOrEqual(parseFloat(getComputedStyle(value).lineHeight)+1)
        }
      }
      fits(footer, `${name} footer`)
      const closeButton = dialog.querySelector('.modal__close-trigger,.drawer__close-trigger')!
      fits(closeButton, `${name} close`)
      for (const button of footer.querySelectorAll('button')) fits(button, `${name} footer button`)
      if (body.scrollHeight > body.clientHeight + 1) {
        body.scrollTop = body.scrollHeight
        await expect.poll(() => body.scrollTop).toBeGreaterThan(0)
        expect(Math.abs(body.scrollHeight - body.clientHeight - body.scrollTop)).toBeLessThanOrEqual(1)
        fits(footer, `${name} footer after scrolling`)
      }
      if (name === "members") {
        for (const button of body.querySelectorAll('button')) {
          expect(rect(button).width).toBeGreaterThanOrEqual(60)
          expect(rect(button).right).toBeLessThanOrEqual(rect(body).right + 1)
        }
      }
      if (name === "candidates") {
        await page.getByText("候选 1",{exact:true}).click()
        await expect.element(page.getByRole("button",{name:"选择这张牌",exact:true})).toBeEnabled()
        await page.getByRole("button",{name:"选择这张牌",exact:true}).click()
        expect(rollControls.choose).toHaveBeenCalledWith(0)
        fits(footer, `${name} footer after choosing`)
      }
      if (name === "ai") {
        await page.getByRole("button",{name:"查看完整接入指令",exact:true}).click()
        expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth+1)
      }
      await page.screenshot({path:`.superpowers/sdd/2026-11-02-mobile-panels/${width}-${height}-${name}-scrolled.png`})
      await userEvent.keyboard("{Escape}")
      await expect.element(page.getByRole("dialog")).not.toBeInTheDocument()
      if (name !== "settlement") await expect.element(page.getByRole("button", {name:"打开测试面板",exact:true})).toHaveFocus()
    } finally { await screen.unmount() }
  })
  it(`${width}×${height} 总览模态框的长内容在正文内滚动`, async () => {
    await page.viewport(width, height)
    function Overview() {
      const [open, setOpen] = useState(false)
      return <PokerMatchOverviewDialog table={stress} perspective="owner" compact={width < 850} open={open} onOpenChange={setOpen} />
    }
    const screen = await render(<Overview />)
    try {
      const trigger = page.getByRole("button", { name: "对局信息", exact: true })
      const dialog = page.getByRole("dialog", { name: "总览", exact: true })
      await trigger.click()
      await expect.element(dialog).toBeVisible()
      await expect.poll(() => dialog.element().closest('[data-slot="modal-container"]')?.hasAttribute("data-entering")).toBe(false)
      const panel = dialog.element()
      const body = panel.querySelector<HTMLElement>(".modal__body")!
      const heading = panel.querySelector(".modal__heading")!
      const close = panel.querySelector(".modal__close-trigger")!
      fits(panel, "总览")
      expect(rect(heading).left - rect(panel).left).toBeGreaterThanOrEqual(16)
      expect(rect(heading).top - rect(panel).top).toBeGreaterThanOrEqual(16)
      const headingText = document.createRange()
      headingText.selectNodeContents(heading)
      expect(headingText.getBoundingClientRect().right).toBeLessThanOrEqual(rect(close).left)
      expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1)
      if (body.scrollHeight > body.clientHeight) {
        const top = rect(heading).top
        body.scrollTop = body.scrollHeight
        await expect.poll(() => body.scrollTop).toBeGreaterThan(0)
        expect(rect(heading).top).toBe(top)
        fits(close, "关闭对局信息")
      }
      await page.screenshot({ path: `.superpowers/sdd/2026-11-02-mobile-panels/${width}-${height}-overview.png` })
      await userEvent.keyboard("{Escape}")
      await expect.element(dialog).not.toBeInTheDocument()
      await expect.element(trigger).toHaveFocus()
    } finally { await screen.unmount() }
  })
  it(`${width}×${height} practice preparation and expanded persona remain reachable`,async()=>{
    await page.viewport(width,height)
    const screen=await render(<div className="h-dvh"><PracticePreparation table={{...stress,seats:[],mySeatNo:null,buyIn:large}} onRefresh={vi.fn()} onBack={vi.fn()}/></div>)
    try {
      const content=document.querySelector<HTMLElement>('[aria-label="陪练配置"]')!
      expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth+1)
      await page.getByText('外部 AI',{exact:true}).click()
      content.scrollTop=content.scrollHeight
      fits(page.getByRole('button',{name:'配置并接入 AI',exact:true}).element(),'practice action')
      await page.screenshot({path:`.superpowers/sdd/2026-11-02-mobile-panels/${width}-${height}-preparation.png`})
    }finally{await screen.unmount()}
    const badge=await render(<div className="w-full p-4"><PersonaBadge version={{versionNo:large,persona:longName}}/></div>)
    try {
      await page.getByText(`v${large}`,{exact:true}).click()
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    }finally{await badge.unmount()}
  })
}
