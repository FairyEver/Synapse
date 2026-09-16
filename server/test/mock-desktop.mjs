/**
 * A stand-in desktop for verifying the iOS client.
 *
 * Connects to the real relay with a real account and publishes a summary plus a
 * stream of terminal frames, so the app's network path, protocol decoding, and
 * rendering can be exercised without disturbing a real Synapse installation
 * (which holds a single-instance lock and may be signed into another account).
 *
 * Usage: node test/mock-desktop.mjs <email> <password> [baseUrl]
 *          [--contend <title>] [--control-port <port>] [--splits]
 */

import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import WebSocket from "ws"

const rawArgs = process.argv.slice(2)
const controlPortFlag = rawArgs.indexOf("--control-port")
/** Where the UI test drives this double from; see startControlServer below. */
const controlPort = controlPortFlag >= 0 && rawArgs[controlPortFlag + 1]
  ? Number(rawArgs[controlPortFlag + 1])
  : 3011
/**
 * Draws the group/tab/pane hierarchy: two of the sessions below share one tab,
 * which is what makes the desktop publish `workspaces` at all. Off by default so
 * that a run which is about the flat list sees exactly the flat list.
 */
const splitFixturesEnabled = rawArgs.includes("--splits")
const contendFlag = rawArgs.indexOf("--contend")
/**
 * Which session stands in for "the desktop user is typing right now" — see the
 * lease simulation below. `--contend none` disables it (no session is called
 * that); the default keeps the test suite working with no extra arguments.
 */
const contendTitles = contendFlag >= 0 && rawArgs[contendFlag + 1]
  ? [rawArgs[contendFlag + 1]]
  : ["build"]
/** Drops each `--flag value` pair so only the positional arguments remain. */
const flagIndexes = new Set()
for (const flag of [contendFlag, controlPortFlag]) {
  if (flag < 0) continue
  flagIndexes.add(flag)
  flagIndexes.add(flag + 1)
}
const positional = rawArgs.filter((_, index) => !flagIndexes.has(index))
const [email, password, baseUrl = "http://127.0.0.1:3001"] = positional
if (!email || !password) {
  console.error(
    "usage: node test/mock-desktop.mjs <email> <password> [baseUrl] [--contend <title>] [--control-port <port>] [--splits]",
  )
  process.exit(1)
}
const wsUrl = baseUrl.replace(/^http/, "ws")
const desktopClientInstanceId = `mock-desktop-${randomUUID().slice(0, 8)}`
const groupId = randomUUID()
const claudeSessionId = randomUUID()
const buildSessionId = randomUUID()
const logSessionId = randomUUID()
const splitLeftId = randomUUID()
const splitRightId = randomUUID()
const splitWorkspaceId = randomUUID()

let accessToken = ""
let desktopWanted = true
let reconnectTimer = null
const frames = new Map()
const sessions = new Map()

function envelope(type, payload) {
  return { type, id: randomUUID(), sentAt: new Date().toISOString(), payload }
}

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) throw new Error(`login failed: ${response.status}`)
  const body = await response.json()
  accessToken = body.accessToken
}

/** Flattens a wire line (`[text]` or `[text, runs]`) to its text. */
function plainText(line) {
  if (typeof line === "string") return line
  if (Array.isArray(line)) return typeof line[0] === "string" ? line[0] : ""
  return ""
}

function makeSession(id, title, cwd, initialLines) {
  const session = {
    id,
    groupId,
    title,
    status: "running",
    attention: { state: "not_waiting", kind: "unknown" },
    cwd,
    cols: 88,
    rows: 24,
    startedAt: new Date(Date.now() - 600_000).toISOString(),
    lastLine: plainText(initialLines.at(-1)),
    lastOutputSeq: 0,
  }
  sessions.set(id, session)
  frames.set(id, initialLines)
  return session
}


function buildSummary() {
  return {
    desktopClientInstanceId,
    desktopName: "Mock MacBook Pro",
    revision: summaryRevision,
    groups: [{ id: groupId, name: "前端开发" }],
    // Absent unless the split fixture is on, which is exactly how a desktop with
    // no splits behaves — the phone must read both.
    ...(splitFixturesEnabled
      ? {
          workspaces: [{
            id: splitWorkspaceId,
            groupId,
            title: "网页调试",
            panes: [
              { paneId: `pane-${splitLeftId}`, sessionId: splitLeftId },
              { paneId: `pane-${splitRightId}`, sessionId: splitRightId },
            ],
          }],
        }
      : {}),
    sessions: [...sessions.values()],
  }
}

let summaryRevision = 0
let socket = null

function sendSummary() {
  summaryRevision += 1
  socket?.send(JSON.stringify(envelope("mobile.summary", buildSummary())))
}

/** Emits frames as `suffix` updates, mirroring what the desktop gateway does. */
function sendFrame(sessionId, from, lines, extra = {}) {
  const all = frames.get(sessionId) ?? []
  all.splice(from, all.length - from, ...lines)
  frames.set(sessionId, all)
  const session = sessions.get(sessionId)
  if (session) {
    session.lastLine = plainText(lines.at(-1)) || session.lastLine
    session.lastOutputSeq += 1
  }
  socket?.send(JSON.stringify(envelope("mobile.frame", {
    desktopClientInstanceId,
    mobileClientInstanceId: currentPhoneId ?? "unknown",
    frame: {
      v: 1,
      sessionId,
      kind: "suffix",
      from,
      lines: lines.map(toWireLine),
      total: all.length,
      cursor: { row: all.length - 1, col: 0, visible: true },
      alt: false,
      truncated: false,
      seq: session?.lastOutputSeq ?? 1,
      sizeRevision: 1,
      ...extra,
    },
  })))
}

/** `[text]` or `[text, runs]` with runs as `[start, length, fg, bg, flags]`. */
function toWireLine(entry) {
  if (typeof entry === "string") return [entry]
  const [text, runs] = entry
  if (!runs || runs.length === 0) return [text]
  return [text, runs]
}

let currentPhoneId = null
let frameTimer = null

function startStreaming() {
  clearInterval(frameTimer)
  // A build log scrolling in, so the app has something continuous to render.
  let tick = 0
  frameTimer = setInterval(() => {
    // A test may have deleted the streamed session; frames for a session the
    // summary no longer lists would be output for something that is gone.
    if (!sessions.has(buildSessionId)) return
    tick += 1
    const line = tick % 7 === 0
      ? [`✓ transformed module ${tick}`, [[0, 1, 2, -1, 0]]]
      : `  ${String(tick).padStart(4, "0")}  chunk ${randomUUID().slice(0, 8)}   ${(tick * 1.7).toFixed(1)} kB`
    const current = frames.get(buildSessionId) ?? []
    sendFrame(buildSessionId, current.length, [line])
    if (tick % 5 === 0) sendSummary()
  }, 700)
}

/**
 * Write-lease simulation (test double only).
 *
 * A real desktop holds a write lease per terminal and refuses the phone's write
 * with `lease_preempted` while its own user is typing. This mock has no keyboard
 * to type on, so the session named by `--contend <title>` stands in for "the
 * desktop user is typing right now": writes to it are refused until the phone
 * takes the lease back with an `unlock` intent, which is exactly what the
 * gateway does with `attachment.leasePreempted`.
 *
 * Every refusal also prints a marker into the terminal. The UI test cannot see
 * the mock's internals, so that line is what proves the preemption path was
 * really exercised instead of silently skipped.
 */
const contended = new Set()

function armContention(sessionId) {
  const session = sessions.get(sessionId)
  if (session && contendTitles.includes(session.title)) contended.add(sessionId)
}

function handleIntent(message) {
  const payload = message.payload
  currentPhoneId = payload.mobileClientInstanceId
  const intent = payload.intent
  const reply = (result) => {
    socket?.send(JSON.stringify(envelope("mobile.intentResult", {
      mobileClientInstanceId: payload.mobileClientInstanceId,
      result: { intentId: intent.intentId, ...result },
    })))
  }

  if (intent.kind === "sync") {
    sendSummary()
    reply({ outcome: "accepted" })
    return
  }
  if (intent.kind === "ping") {
    reply({ outcome: "no_op" })
    return
  }
  if (intent.kind === "attach") {
    // Re-armed per attach so a test run is reproducible against a long-lived mock.
    armContention(intent.sessionId)
    reply({ outcome: "accepted", sessionId: intent.sessionId })
    const lines = frames.get(intent.sessionId) ?? []
    socket?.send(JSON.stringify(envelope("mobile.frame", {
      desktopClientInstanceId,
      mobileClientInstanceId: payload.mobileClientInstanceId,
      frame: {
        v: 1,
        sessionId: intent.sessionId,
        kind: "reset",
        from: 0,
        lines: lines.map(toWireLine),
        total: lines.length,
        cursor: { row: lines.length - 1, col: 0, visible: true },
        alt: false,
        truncated: false,
        seq: sessions.get(intent.sessionId)?.lastOutputSeq ?? 1,
        sizeRevision: 1,
      },
    })))
    return
  }
  if (intent.kind === "unlock") {
    // How the phone takes the lease back. The gateway clears `leasePreempted`
    // here, so a mock that answered `no_op` would strand the retry.
    contended.delete(intent.sessionId)
    reply({ outcome: "accepted", sessionId: intent.sessionId })
    return
  }
  if ((intent.kind === "command" || intent.kind === "keys") && contended.has(intent.sessionId)) {
    const current = frames.get(intent.sessionId) ?? []
    sendFrame(intent.sessionId, current.length, [
      `[mock] desktop took the lease and refused the ${intent.kind}`,
    ])
    reply({
      outcome: "rejected",
      code: "lease_preempted",
      message: "桌面端正在使用这个终端。",
    })
    return
  }
  if (intent.kind === "keys") {
    // Approving the simulated permission prompt clears the attention badge, so
    // the app's badge and inbox visibly react to the round trip.
    const session = sessions.get(intent.sessionId)
    if (session?.attention.state === "waiting") {
      session.attention = { state: "not_waiting", kind: "unknown" }
      session.lastLine = "✓ 已允许，继续执行"
      const current = frames.get(intent.sessionId) ?? []
      sendFrame(intent.sessionId, current.length, [
        "",
        [`● Bash(npm run build)`, [[0, 1, 2, -1, 1]]],
        [`  ⎿  ✓ built in 4.21s`, [[5, 1, 2, -1, 0], [7, 14, -1, -1, 8]]],
      ])
      sendSummary()
    }
    reply({ outcome: "accepted", sessionId: intent.sessionId })
    return
  }
  if (intent.kind === "command") {
    const current = frames.get(intent.sessionId) ?? []
    sendFrame(intent.sessionId, current.length, [
      `$ ${intent.text}`,
      `mock desktop received: ${intent.text}`,
    ])
    sendSummary()
    reply({ outcome: "accepted", sessionId: intent.sessionId })
    return
  }
  if (intent.kind === "rename") {
    const session = sessions.get(intent.sessionId)
    if (session) session.title = intent.title
    sendSummary()
    reply({ outcome: "accepted", sessionId: intent.sessionId })
    return
  }
  if (intent.kind === "delete") {
    // A live terminal cannot be deleted directly on the real desktop either: the
    // gateway stops it, and the PTY exiting is what removes it. Either way the
    // phone's row ends up gone, which is the part this double reproduces. Whether
    // the gateway picks stop or delete is covered by the gateway's own tests.
    sessions.delete(intent.sessionId)
    frames.delete(intent.sessionId)
    sendSummary()
    reply({ outcome: "accepted", sessionId: intent.sessionId })
    return
  }
  if (intent.kind === "stop") {
    const session = sessions.get(intent.sessionId)
    if (session) session.status = "ended"
    sendSummary()
    reply({ outcome: "accepted", sessionId: intent.sessionId })
    return
  }
  reply({ outcome: "no_op" })
}

function disconnectDesktop() {
  // Set before closing: the close handler reconnects on its own, and a test that
  // asked for the computer to go away has to be able to see it stay away.
  desktopWanted = false
  clearTimeout(reconnectTimer)
  reconnectTimer = null
  const current = socket
  socket = null
  current?.close()
}

function scheduleReconnect() {
  if (!desktopWanted || reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, 2_000)
}

/**
 * Lets a UI test make the computer come and go.
 *
 * The test runs inside the simulator and cannot start a process on the host, so
 * without this there is no way to reproduce the reported bug end to end: the
 * phone has to already be watching while nothing is online, and only then does a
 * computer sign in. Driving it from the test also removes the timing guesswork
 * that a delayed startup would have.
 */
function startControlServer(port) {
  const server = createServer((request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405).end()
      return
    }
    const route = request.url ?? ""
    if (route === "/desktop/disconnect") {
      disconnectDesktop()
      response.writeHead(200).end("disconnected")
      return
    }
    if (route === "/desktop/connect") {
      if (!socket) connect()
      response.writeHead(200).end("connected")
      return
    }
    response.writeHead(404).end()
  })
  server.listen(port, "127.0.0.1", () => {
    console.log(`mock desktop control listening on http://127.0.0.1:${port}`)
  })
}

function connect() {
  desktopWanted = true
  clearTimeout(reconnectTimer)
  reconnectTimer = null
  socket = new WebSocket(`${wsUrl}/api/live/desktop`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  socket.on("open", () => {
    socket.send(JSON.stringify(envelope("live.hello", {
      clientInstanceId: desktopClientInstanceId,
      appVersion: "0.0.0-mock",
      platform: "darwin-arm64",
      deviceName: "Mock MacBook Pro",
    })))
  })
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw))
    if (message.type === "live.welcome") {
      console.log(`mock desktop online as ${desktopClientInstanceId}`)
      sendSummary()
      return
    }
    if (message.type === "mobile.intent") handleIntent(message)
    if (message.type === "mobile.detached") {
      console.log(`phone ${message.payload.mobileClientInstanceId} went away`)
    }
  })
  socket.on("close", (code, reason) => {
    console.log(`socket closed code=${code} reason=${reason?.toString() || "(none)"}`)
    scheduleReconnect()
  })
  // The access token lives 15 minutes; a long-running mock must renew it or it
  // reconnects forever with a credential the server keeps rejecting.
  socket.on("unexpected-response", (_request, response) => {
    if (response.statusCode === 401) {
      console.log("access token expired; re-authenticating")
      void login()
        .then(() => setTimeout(connect, 1_000))
        .catch((error) => console.error("re-login failed:", error.message))
      return
    }
    console.error(`upgrade rejected: ${response.statusCode}`)
  })
  socket.on("error", (error) => console.error("socket error:", error.message))
}

await login()

makeSession(logSessionId, "api-logs", "/Users/liy/srv/api", [
  `$ pnpm logs`,
  [`[14:02:11] GET  /v1/orders        200  14ms`, [[0, 10, 8, -1, 0]]],
  [`[14:02:13] POST /v1/orders        201  38ms`, [[0, 10, 8, -1, 0]]],
  [`[14:02:18] GET  /v1/catalog       200   9ms`, [[0, 10, 8, -1, 0]]],
])

makeSession(buildSessionId, "build", "/Users/liy/code/synapse", [
  `$ pnpm run build`,
  `> synapse@0.2.468 build`,
  `> tsc -b && vite build`,
  "",
])

// Only when asked: two terminals sharing one tab.
if (splitFixturesEnabled) {
  makeSession(splitLeftId, "web-a", "/Users/liy/code/web", [`$ pnpm dev`, `  ready in 812 ms`, ""])
  makeSession(splitRightId, "web-b", "/Users/liy/code/web", [`$ pnpm test`, `  24 passed`, ""])
}

makeSession(claudeSessionId, "claude-code", "/Users/liy/code/synapse", [
  `$ claude`,
  "",
  [` Claude Code v2.1.0`, [[0, 17, -1, -1, 1]]],
  ` 把 src/utils/date.ts 的 formatDate 改成用 Intl.DateTimeFormat`,
  "",
  [` ● Read(src/utils/date.ts)`, [[0, 2, 2, -1, 0]]],
  [` ● Update(src/utils/date.ts)`, [[0, 2, 2, -1, 0]]],
  "",
  [` ⏺ Bash(npm run build)`, [[1, 20, 3, -1, 1]]],
  `   需要确认 — 在手机上点「允许」继续`,
  "",
  [`╭${"─".repeat(60)}╮`, [[0, 62, -1, -1, 0]]],
  [`│ Bash command`, [[0, 55, -1, -1, 0]]],
  [`│   npm run build`, [[0, 55, -1, -1, 0]]],
  [`│ Do you want to proceed?`, [[0, 55, -1, -1, 0]]],
  [`│ ❯ 1. Yes`, [[0, 55, -1, -1, 0]]],
  [`│   2. Yes, and don't ask again`, [[0, 55, -1, -1, 0]]],
  [`│   3. No, and tell Claude what to do`, [[0, 55, -1, -1, 0]]],
  [`╰${"─".repeat(60)}╯`, [[0, 62, -1, -1, 0]]],
])
sessions.get(claudeSessionId).attention = { state: "waiting", kind: "approval" }
sessions.get(claudeSessionId).lastLine = "Do you want to proceed?"

connect()
startStreaming()
startControlServer(controlPort)

process.on("SIGINT", () => {
  clearInterval(frameTimer)
  socket?.close()
  process.exit(0)
})
