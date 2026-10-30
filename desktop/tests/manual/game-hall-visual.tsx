import { PokerHandPreview } from "@/modules/game-hall/games/poker/components/PokerPreview"
// Local visual fixture: production components with synthetic data, no account or network.
import { Spade } from "lucide-react"
import { RoomList } from "@/modules/game-hall/games/poker/components/RoomList"
import { useState } from "react"
import { createRoot } from "react-dom/client"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { HallHome } from "@/modules/game-hall/components/HallHome"
import { Table } from "@/modules/game-hall/games/poker/components/Table"
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
    <PokerHandPreview
      hand={{
        handId: "preview",
        roomCode: "4821",
        handNo: 27,
        seatNo: 0,
        delta: 128,
        result: "won",
        hole: ["As", "Kh"],
        board: [],
        createdAt: "2026-10-30T01:00:00Z",
      }}
    />
  )
}
const options = new URLSearchParams(location.search)
const initialSeats = Number(options.get("seats") ?? 6)
document.documentElement.classList.toggle("dark", options.get("theme") === "dark")
function Fixture() {
  const [view, setView] = useState(options.get("view") ?? "hall"),
    [perspective, setPerspective] = useState<"owner" | "public">("owner")
  const seatCount = [2, 6, 10].includes(initialSeats) ? initialSeats : 6
  const scene = {
    ...table,
    maxSeats: seatCount,
    seats: Array.from({ length: seatCount }, (_, i) => ({
      ...table.seats[i % 6],
      seatNo: i,
      isMe: i === 0,
      ...(i === 0 ? { hole: ["As", "Kh"] } : { hole: undefined }),
    })),
  }
  return (
    <div className="h-screen">
      <SystemAppWindowShell
        left={
          <span className="text-sm font-medium">{view === "hall" ? "游戏大厅" : "德州扑克"}</span>
        }
        actions={
          view !== "hall" ? (
            <SystemAppTopBarActionButton onClick={() => setView("hall")}>
              返回大厅
            </SystemAppTopBarActionButton>
          ) : undefined
        }
      >
        <div className="game-hall h-full bg-background text-foreground">
          {view === "hall" ? (
            <HallHome
              overview={overview}
              previews={{ "/poker": Preview }}
              icons={{ "/poker": Spade }}
              onEnter={() => setView("rooms")}
              onSession={() => setView("table")}
              onGrant={() => {}}
            />
          ) : view === "rooms" ? (
            <div className="mx-auto max-w-6xl space-y-6 p-8">
              <h2 className="font-medium">房间</h2>
              <RoomList
                rooms={[
                  {
                    roomCode: "4821",
                    name: "晚间牌桌",
                    ownerUserId: "me",
                    maxSeats: 6,
                    buyIn: 1000,
                    status: "running",
                    smallBlind: 1,
                    bigBlind: 2,
                    players: 4,
                  },
                  {
                    roomCode: "5077",
                    name: null,
                    ownerUserId: "other",
                    maxSeats: 2,
                    buyIn: 500,
                    status: "paused",
                    smallBlind: 1,
                    bigBlind: 2,
                    players: 2,
                  },
                  {
                    roomCode: "9931",
                    name: "好友牌桌",
                    ownerUserId: "other",
                    maxSeats: 10,
                    buyIn: 5000,
                    status: "waiting",
                    smallBlind: 1,
                    bigBlind: 2,
                    players: 1,
                  },
                ]}
                myRoomCodes={["4821"]}
                userId="me"
                onRoom={() => setView("table")}
                onConnect={() => {}}
                onClose={() => {}}
              />
            </div>
          ) : (
            <Table
              table={scene}
              perspective={perspective}
              onPerspective={setPerspective}
              onNudge={() => {}}
              onBack={() => setView("rooms")}
            />
          )}
        </div>
      </SystemAppWindowShell>
    </div>
  )
}
const root = createRoot(document.getElementById("root")!)
root.render(<Fixture />)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
