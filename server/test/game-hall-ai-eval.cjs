/* Manual acceptance runner: real Claude Code + Codex, isolated loopback Postgres only. */
const { createServer } = require("node:http")
const { spawn } = require("node:child_process")
const { mkdtemp, writeFile, readFile } = require("node:fs/promises")
const { tmpdir } = require("node:os")
const { join, resolve } = require("node:path")
const { randomUUID } = require("node:crypto")
const { PrismaClient } = require("@prisma/client")
const { HallService } = require("../dist/game/hall/hall.service")
const { PokerService } = require("../dist/game/poker/poker.service")
const { PokerActionService } = require("../dist/game/poker/poker-action.service")
const { PokerDeadlineTask } = require("../dist/game/poker/poker-deadline.task")
const { PokerReadService } = require("../dist/game/poker/poker-read.service")
const { PokerWaitService } = require("../dist/game/poker/poker-wait.service")
const { GameApiService } = require("../dist/game/game-api.service")
const { GameController } = require("../dist/game/game.controller")
const url = process.env.GAME_E2E_DATABASE_URL
if (!url || !/^postgresql:\/\/[^/]*@127\.0\.0\.1:55439\/synapse_game_e2e$/.test(url))
  throw new Error("Only the task-owned loopback test database is allowed")
const root = resolve(__dirname, "../.."),
  db = new PrismaClient({ datasources: { db: { url } } }),
  hall = new HallService(db),
  poker = new PokerService(db, hall),
  actions = new PokerActionService(poker),
  wait = new PokerWaitService(actions),
  read = new PokerReadService(poker)
const api = new GameApiService(hall, poker, actions, wait, read, {
  nudge: () => {
    throw new Error("No real notifications in the fixture")
  },
})
const controller = new GameController(api, actions, poker),
  users = [randomUUID(), randomUUID()]
const deadlineTask = new PokerDeadlineTask(actions)
let reconnectDelay,
  maintenanceTimer,
  maintenanceRun = Promise.resolve()
const children = new Set(),
  calls = []
const summaries = {}
let roomCode,
  closed = false,
  restarted = false,
  restartPending = false,
  claudeChild,
  base,
  configPath,
  runDir
const report = {
  startedAt: new Date().toISOString(),
  mode: "real-cli-loopback-fixture",
  clients: ["Claude Code", "Codex"],
  completedHands: 0,
  reconnect: null,
  failures: [],
}
function event(type, extra = {}) {
  process.stdout.write(JSON.stringify({ type, ...extra }) + "\n")
}
const server = createServer(async (req, res) => {
  if (
    req.headers.authorization !== `Bearer ${users[0]}` &&
    req.headers.authorization !== `Bearer ${users[1]}`
  ) {
    res.writeHead(401)
    res.end()
    return
  }
  const user = req.headers.authorization.slice(7)
  try {
    let body = ""
    for await (const chunk of req) {
      body += chunk
      if (body.length > 100000) throw new Error("Fixture request too large")
    }
    const parsed = JSON.parse(body || "{}")
    calls.push({ user, operation: parsed.operation, at: Date.now() })
    let result
    if (req.url === "/api/game/invoke")
      result = await controller.invoke({ user: { id: user } }, parsed, res)
    else throw new Error("Unknown fixture route")
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify(result))
    if (parsed.operation === "app.game.poker.action.act") {
      const room = await db.gamePokerRoom.findUnique({ where: { code: roomCode } })
      const completed = Math.max(0, room.handNo - 1)
      if (completed > report.completedHands) {
        report.completedHands = completed
        event("hand-complete", { handNo: completed })
      }
    }
    if (
      !restarted &&
      !restartPending &&
      report.completedHands >= 5 &&
      user === users[0] &&
      parsed.operation === "app.game.poker.table.wait" &&
      result?.data?.status === "your_turn"
    ) {
      restartPending = true
      setTimeout(() => void restartClaude(), 0)
    }
  } catch (error) {
    if (!res.headersSent) res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ ok: false, failure: { code: "EVAL_ERROR", message: error.message } }))
  }
})
async function prompt(reconnect) {
  const skill = await readFile(
    join(root, "desktop/app-capabilities/synapse-skill/skill-package/game-hall/poker/SKILL.md"),
    "utf8",
  )
  return `你是德州扑克验收中的真实AI选手，不是开发Agent。用户已授权在隔离测试库玩到第50手完成。只用game_hall_eval的search/invoke，禁止文件/终端/代码操作，不要委派任务。房间号${roomCode}。${reconnect ? "你是全新会话，第一项游戏调用必须overview，沿它找到原座位；不要重新入座。" : "先guide、overview，没有座位才入座。"} 按下面Skill持续循环，不得以“已开始”“继续循环”结束。保守打法以合法check/call为主，也可自主fold；不做大额加注，保证50手不破产。每次your_turn都由你自己调用act，不能写脚本代打；actionId你自行生成UUID。只在收到hand_result.handNo>=50时结束并seat_sit(true)。非轮次继续wait，最长25秒。此处掉线重开已获授权，600秒内overview恢复即可。\n${skill}`
}
function launch(kind, reconnect = false) {
  const isClaude = kind === "claude"
  const args = isClaude
    ? [
        "-p",
        "--strict-mcp-config",
        "--mcp-config",
        configPath,
        "--allowedTools",
        "mcp__game_hall_eval__search,mcp__game_hall_eval__invoke",
        "--tools",
        "",
        "--output-format",
        "stream-json",
        "--verbose",
      ]
    : [
        "exec",
        "--ignore-user-config",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "--json",
        "-c",
        `mcp_servers.game_hall_eval={command="node",args=["/tmp/synapse-game-hall-eval-mcp.cjs","${base}","${users[1]}"],enabled_tools=["search","invoke"],tools={search={approval_mode="approve"},invoke={approval_mode="approve"}}}`,
        "-",
      ]
  const child = spawn(isClaude ? "claude" : "codex", args, {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
    env: { ...process.env },
  })
  children.add(child)
  let out = ""
  child.stdout.on("data", (chunk) => {
    out += chunk
    let index
    while ((index = out.indexOf("\n")) >= 0) {
      const line = out.slice(0, index)
      out = out.slice(index + 1)
      try {
        const e = JSON.parse(line)
        if (e.type === "item.completed" && e.item?.type === "agent_message")
          summaries[kind] = String(e.item.text ?? "")
            .replace(/\b[2-9TJQKA][shdc]\b/g, "[card]")
            .slice(0, 800)
        if (e.type === "result" && e.result)
          summaries[kind] = String(e.result)
            .replace(/\b[2-9TJQKA][shdc]\b/g, "[card]")
            .slice(0, 800)
        if (e.type === "result" || e.type === "error")
          event("client-event", { client: kind, eventType: e.type, isError: !!e.is_error })
      } catch {
        continue
      }
    }
  })
  child.stderr.on("data", () => {})
  child.on("exit", (code, signal) => {
    children.delete(child)
    event("client-exit", { client: kind, code, signal, summary: summaries[kind] })
    if (
      !closed &&
      !(kind === "claude" && restartPending && !restarted) &&
      signal !== "SIGTERM" &&
      report.completedHands < 50
    )
      report.failures.push(`${kind} exited early (${code})`)
  })
  void prompt(reconnect).then((p) => child.stdin.end(p))
  if (isClaude) claudeChild = child
  return child
}
async function restartClaude() {
  const seat = await db.gamePokerSeat.findFirst({
    where: {
      userId: users[0],
      roomId: (await db.gamePokerRoom.findUnique({ where: { code: roomCode } })).id,
    },
  })
  if (!seat) return
  event("reconnect-stop", { seconds: 120 })
  if (claudeChild && !claudeChild.killed) process.kill(-claudeChild.pid, "SIGTERM")
  await new Promise((resolve) => {
    reconnectDelay = setTimeout(resolve, 120000)
  })
  if (closed) return
  const before = calls.length
  restarted = true
  launch("claude", true)
  report.reconnect = {
    oldSeatId: seat.id,
    restartedAt: new Date().toISOString(),
    firstCallIndex: before,
  }
  event("reconnect-start")
}
async function main() {
  runDir = await mkdtemp(join(tmpdir(), "synapse-game-ai-"))
  const room = await poker.createRoom(users[0], { maxSeats: 6, buyIn: 1000, name: "真实AI验收" })
  roomCode = room.roomCode
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${server.address().port}`
  configPath = join(runDir, "claude-mcp.json")
  await writeFile(
    configPath,
    JSON.stringify({
      mcpServers: {
        game_hall_eval: {
          command: "node",
          args: ["/tmp/synapse-game-hall-eval-mcp.cjs", base, users[0]],
        },
      },
    }),
  )
  event("fixture-ready", { roomCode, reportPath: join(runDir, "report.json") })
  if (process.env.GAME_EVAL_SMOKE_ONLY === "1") {
    const transport = spawn("node", ["/tmp/synapse-game-hall-eval-mcp.cjs", base, users[0]], {
      stdio: ["pipe", "pipe", "inherit"],
    })
    children.add(transport)
    transport.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05" },
      }) + "\n",
    )
    transport.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "invoke",
          arguments: { toolName: "app_game_hall_overview", arguments: {} },
        },
      }) + "\n",
    )
    await new Promise((resolve, reject) => {
      let text = ""
      const timer = setTimeout(() => reject(new Error("Smoke timeout")), 10000)
      transport.stdout.on("data", (chunk) => {
        text += chunk
        for (const line of text.split("\n"))
          try {
            const message = JSON.parse(line)
            if (message.id === 2) {
              const body = JSON.parse(message.result.content[0].text)
              if (message.result.isError || !body.points) reject(new Error("Smoke invoke failed"))
              else {
                event("smoke-passed")
                clearTimeout(timer)
                resolve()
              }
            }
          } catch {}
      })
    })
    transport.stdin.end()
    children.delete(transport)
    await finish()
    return
  }
  maintenanceTimer = setInterval(() => {
    maintenanceRun = deadlineTask.scan().catch((error) => report.failures.push(error.message))
  }, 1000)
  launch("claude")
  launch("codex")
  const deadline = Date.now() + 45 * 60000
  while (Date.now() < deadline && !report.failures.length) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const room = await db.gamePokerRoom.findUnique({ where: { code: roomCode } })
    report.completedHands = Math.max(0, room.handNo - 1)
    if (report.completedHands >= 50) break
  }
  if (report.reconnect) {
    const room = await db.gamePokerRoom.findUnique({ where: { code: roomCode } })
    const seat = await db.gamePokerSeat.findFirst({ where: { roomId: room.id, userId: users[0] } })
    report.reconnect.sameSeat = seat?.id === report.reconnect.oldSeatId
    report.reconnect.firstOperation = calls
      .slice(report.reconnect.firstCallIndex)
      .find((c) => c.user === users[0])?.operation
  }
  const points = await Promise.all(users.map((u) => hall.overview(u)))
  report.pointsConserved = points.reduce((n, p) => n + p.points.total, 0) === 2000000
  report.finishedAt = new Date().toISOString()
  await finish()
  if (report.completedHands < 50 || !report.pointsConserved || !report.reconnect?.sameSeat)
    process.exitCode = 1
}
async function finish() {
  closed = true
  clearTimeout(reconnectDelay)
  clearInterval(maintenanceTimer)
  await maintenanceRun
  for (const child of children)
    try {
      process.kill(-child.pid, "SIGTERM")
    } catch (error) {
      event("child-cleanup-failed", { code: error.code })
    }
  wait.onModuleDestroy()
  await new Promise((resolve) => server.close(resolve))
  await db.$disconnect()
  await writeFile(join(runDir, "report.json"), JSON.stringify(report, null, 2))
  event("fixture-stopped", {
    completedHands: report.completedHands,
    reportPath: join(runDir, "report.json"),
  })
}
process.once("SIGINT", () => void finish())
process.once("SIGTERM", () => void finish())
main().catch(async (error) => {
  report.failures.push(error.message)
  event("fixture-failed", { message: error.message })
  if (runDir) await finish()
  process.exitCode = 1
})
