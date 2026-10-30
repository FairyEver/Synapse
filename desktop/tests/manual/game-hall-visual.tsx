// Local visual fixture: production components with synthetic data, no account or network.
import { useState } from "react"
import { createRoot } from "react-dom/client"
import { Button } from "@/components/ui/button"
import { HallHome } from "@/modules/game-hall/components/HallHome"
import { Table } from "@/modules/game-hall/games/poker/components/Table"
import { Card } from "@/modules/game-hall/games/poker/components/Card"
import type { HallOverview, PokerTableView } from "@synapse/shared/game-contracts"
import "@/styles/globals.css"
const overview: HallOverview = {
  points: { total: 1000250, available: 998000, inPlay: 2250, netProfit: 250 },
  sessions: [
    {
      game: "poker",
      gameName: "德州扑克",
      roomCode: "4821",
      seatNo: 0,
      status: "active",
      needsAction: true,
      deadlineMs: 511000,
    },
    {
      game: "poker",
      gameName: "德州扑克",
      roomCode: "5077",
      seatNo: 1,
      status: "active",
      needsAction: false,
      deadlineMs: null,
    },
  ],
  games: [{ id: "poker", name: "德州扑克", icon: "spade", entry: "/poker", status: "available" }],
  next: { game: "poker", roomCode: "4821" },
}
const table: PokerTableView = {
  roomCode: "4821",
  name: null,
  status: "running",
  buyIn: 1000,
  maxSeats: 6,
  handId: "fixture",
  handNo: 28,
  street: "flop",
  board: ["Ah", "7s", "2d"],
  pot: 144,
  dealerSeat: 3,
  actionOnSeat: 0,
  deadlineMs: 511000,
  cursor: "28:4",
  mySeatNo: 0,
  seats: Array.from({ length: 6 }, (_, i) => ({
    seatNo: i,
    displayName: [
      "我的codex",
      "小张的deepseek",
      "小林的qwen",
      "小王的Claude",
      "小陈",
      "小周的codex",
    ][i],
    stack: 1000 - i * 24,
    status: "active",
    isMe: i === 0,
    streetBet: i * 2,
    aiState: i === 2 ? "offline" : "online",
    ...(i === 0 ? { hole: ["As", "Kh"] } : {}),
  })),
  recentActions: [
    { seq: 1, seatNo: 1, street: "preflop", action: "call", amount: 2, potAfter: 5, isAuto: false },
    {
      seq: 2,
      seatNo: 0,
      street: "preflop",
      action: "raise",
      amount: 24,
      potAfter: 29,
      isAuto: false,
      note: "保持位置优势，控制底池。",
      personaVersionId: null,
      personaVersion: null,
    },
  ],
  persona: "稳健，优先控制风险。",
  deckRemaining: 37,
}
function Preview() {
  return (
    <div className="flex gap-1" data-card-size="xs">
      <Card card="As" />
      <Card card="Kh" />
    </div>
  )
}
function Fixture() {
  const [dark, setDark] = useState(false),
    [view, setView] = useState("hall"),
    [perspective, setPerspective] = useState<"owner" | "public">("owner")
  return (
    <div className="game-hall min-h-screen bg-background text-foreground">
      <nav className="flex items-center gap-3 border-b p-3">
        <span className="mr-auto font-medium">游戏大厅</span>
        <Button
          variant="outline"
          onClick={() => {
            setDark(!dark)
            document.documentElement.classList.toggle("dark", !dark)
          }}
        >
          {dark ? "切换浅色" : "切换深色"}
        </Button>
        <Button variant="outline" onClick={() => setView(view === "hall" ? "table" : "hall")}>
          {view === "hall" ? "查看牌桌" : "查看大厅"}
        </Button>
      </nav>
      {view === "hall" ? (
        <HallHome
          overview={overview}
          previews={{ "/poker": Preview }}
          onEnter={() => setView("table")}
          onSession={() => setView("table")}
          onGrant={() => {}}
        />
      ) : (
        <Table
          table={table}
          perspective={perspective}
          onPerspective={setPerspective}
          onNudge={() => {}}
          onBack={() => setView("hall")}
        />
      )}
    </div>
  )
}
createRoot(document.getElementById("root")!).render(<Fixture />)
