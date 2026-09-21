/**
 * A stand-in desktop for verifying the iOS client.
 *
 * Connects to the real relay with a real account and publishes a summary plus a
 * stream of terminal frames, so the app's network path, protocol decoding, and
 * rendering can be exercised without disturbing a real Synapse installation
 * (which holds a single-instance lock and may be signed into another account).
 *
 * Usage: node test/mock-desktop.mjs <email> <password> [baseUrl]
 *          [--contend <title>] [--control-port <port>] [--control-host <host>]
 *          [--name <device name>] [--instance-id <client instance id>]
 *          [--splits] [--no-toolbar]
 *
 * What this double stands in for, and what it does not.
 *
 * A double is only worth what it does not lie about. Everything below is written to
 * the gateway's actual answers — the outcome values, the refusal codes and their
 * sentences, and above all the states a terminal is left in — because a test that
 * reads the phone against a state the real computer never produces is green about
 * nothing. Two rules follow from that and are worth keeping when editing this file:
 *
 *  - Every state a handler leaves behind has to be one the real desktop can be in.
 *    A stopped terminal is *gone* from the list rather than left sitting in it, a
 *    snapshot carries the gateway's own window rather than the whole buffer, and a
 *    terminal that is not there is refused rather than pretended.
 *  - A kind this double does not implement is refused as `mock_unimplemented_intent`,
 *    never a plausible-looking success and never the quiet `no_op` that used to stand in
 *    for "the computer did nothing". The kinds it answers are `sync`, `ping`, `attach`,
 *    `detach`, `history`, `unlock`, `command`, `keys`, `stop`, `stopAll`, `delete`,
 *    `rename`, `resize`, `releaseGrid` and `fileUpload`. The three it does not stand in
 *    for — `create`, `createAgentConversation` and `launchCommand`, and with them the
 *    whole New Terminal panel — are named in the refusal, so a test that needs one fails
 *    saying so instead of passing on an answer no computer gives.
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
const controlHostFlag = rawArgs.indexOf("--control-host")
/**
 * Which interface the control channel listens on.
 *
 * Loopback by default, because that is all a simulator needs and this channel has no
 * authentication — it can make the double come and go. Running the UI tests on a
 * physical device is the case that needs `0.0.0.0`: the phone is not on this machine's
 * loopback, and neither is the test runner.
 */
const controlHost = controlHostFlag >= 0 && rawArgs[controlHostFlag + 1]
  ? rawArgs[controlHostFlag + 1]
  : "127.0.0.1"
/**
 * Draws the group/tab/pane hierarchy: two of the sessions below share one tab,
 * which is what makes the desktop publish `workspaces` at all. Off by default so
 * that a run which is about the flat list sees exactly the flat list.
 */
const splitFixturesEnabled = rawArgs.includes("--splits")
/**
 * Behave like a desktop from before `mobile.toolbar` existed: one that cannot describe
 * its buttons at all.
 *
 * That is a different answer from a computer that says it has none, and the phone is
 * supposed to show its own built-ins for it rather than an empty bar — without which a
 * phone has no way to confirm anything in a TUI. Worth being able to produce on demand,
 * because the two answers look identical from here.
 *
 * It suppresses `mobile.quickPhrases` too, and for the same reason rather than as a
 * convenience: a computer from before this family existed has never sent either message,
 * so one switch covers both halves of "an older computer". What it must not be is a way
 * to produce "a computer with no sentences" — that is the empty list, which is a computer
 * that *can* say so and says none.
 */
const toolbarSuppressed = rawArgs.includes("--no-toolbar")
const contendFlag = rawArgs.indexOf("--contend")
/**
 * Which session stands in for "the desktop user is typing right now" — see the
 * lease simulation below. `--contend none` disables it (no session is called
 * that); the default keeps the test suite working with no extra arguments.
 */
const contendTitles = contendFlag >= 0 && rawArgs[contendFlag + 1]
  ? [rawArgs[contendFlag + 1]]
  : ["build"]
/**
 * The name this double calls itself, for the phone's computer picker.
 *
 * Two doubles on one account are otherwise indistinguishable there: the client id is
 * random per process and the default name is a constant, so a test that switches
 * between them would be switching between two identical rows.
 */
const nameFlag = rawArgs.indexOf("--name")
const desktopName = nameFlag >= 0 && rawArgs[nameFlag + 1]
  ? rawArgs[nameFlag + 1]
  : "Mock MacBook Pro"
/**
 * This double's client id, stable across restarts unless one is given.
 *
 * A real desktop persists its id (`clientIdStore.getOrCreate`), and the phone's memory
 * of which computer it is on is keyed by it. A double that invented a new id every time
 * it started was not standing in for that: a phone that had been on it would come back
 * to an id no computer would ever claim again, and sit there saying it was offline. That
 * is a phone-side test failure caused entirely by the double being unfaithful.
 *
 * Defaulted from the name rather than left random, so two doubles with different names
 * are two computers that each keep their identity between runs. Two with the *same*
 * name are now the same computer, which is what a second copy of one machine is.
 */
const instanceIdFlag = rawArgs.indexOf("--instance-id")
const desktopClientInstanceId = instanceIdFlag >= 0 && rawArgs[instanceIdFlag + 1]
  ? rawArgs[instanceIdFlag + 1]
  : `mock-desktop-${desktopName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`
/** Drops each `--flag value` pair so only the positional arguments remain. */
const flagIndexes = new Set()
for (const flag of [contendFlag, controlPortFlag, controlHostFlag, nameFlag, instanceIdFlag]) {
  if (flag < 0) continue
  flagIndexes.add(flag)
  flagIndexes.add(flag + 1)
}
const positional = rawArgs.filter((_, index) => !flagIndexes.has(index))
const [email, password, baseUrl = "http://127.0.0.1:3001"] = positional
if (!email || !password) {
  console.error(
    "usage: node test/mock-desktop.mjs <email> <password> [baseUrl] [--contend <title>]"
    + " [--control-port <port>] [--control-host <host>] [--name <device name>]"
    + " [--instance-id <client instance id>] [--splits] [--no-toolbar]",
  )
  process.exit(1)
}
const wsUrl = baseUrl.replace(/^http/, "ws")
const groupId = randomUUID()
const claudeSessionId = randomUUID()
const buildSessionId = randomUUID()
/**
 * A terminal nothing else uses, so a test that has to stop one can.
 *
 * The fixtures above are each consumed by a test — `api-logs` is renamed, `build` is
 * deleted — and stopping one of them would take it away from whoever runs next. This
 * one exists only to be ended, which is a state no other fixture can be put in.
 */
const scratchSessionId = randomUUID()

/** The plain shell `TerminalFileRelayUITests` sends files to; see its seeding below. */
const relaySessionId = randomUUID()
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


/**
 * `MOBILE_FRAME_LIMITS.maxSummaryLastLineLength`, restated here because this file is
 * plain JavaScript and does not import the shared package. A summary that exceeds it
 * is not trimmed by the relay — the socket is closed — so a double that can produce
 * one takes its own connection down.
 */
const SUMMARY_LAST_LINE_LIMIT = 120

/**
 * `DEFAULT_LINE_WINDOW` in `mobile-gateway-service.ts`: how many lines one snapshot
 * carries.
 *
 * A snapshot is a *window*, not the buffer. The desktop keeps the scrollback and the
 * phone pages back into it, which is what the `history` intent is for — so a double
 * that hands over everything at once does not merely overshoot a constant, it makes
 * the whole paging path unreachable from a test.
 */
const LINE_WINDOW_LINES = 500

/** `MOBILE_FRAME_LIMITS.maxLinesPerFrame`. The relay closes the desktop's connection
 *  over a frame that breaks it, so a double that can build one takes its own run down —
 *  which is exactly what happened here once before, with an over-long `lastLine`. */
const MAX_LINES_PER_FRAME = 512

/** `MOBILE_FRAME_LIMITS.maxHistoryLines`: the most a single history page may carry. */
const MAX_HISTORY_LINES = 500

/**
 * Sessions this phone has opened, which the gateway tracks per phone as attachments.
 *
 * Three intents are refused on an unattached terminal (`history`, `command`, `keys`),
 * and `detach` is the only thing that takes one away again. Without the list a double
 * cannot tell "the phone is looking at this" from "the phone is guessing at it".
 */
const attached = new Set()

function buildSummary() {
  return {
    desktopClientInstanceId,
    // The same name this double greets the relay with. Hardcoding one here while the
    // hello used `--name` made two doubles on one account contradict themselves: the
    // phone believed the summary, filed the name under the wrong computer, and the
    // picker offered two rows with the same word in them.
    desktopName,
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
    // Clamped, like the real desktop clamps it: `lastLine` is a display string the
    // wire bounds at `maxSummaryLastLineLength`, and a producer that can exceed that
    // bound does not get a truncated summary — it gets its whole connection closed,
    // which is what happened here the first time this double echoed a long line.
    sessions: [...sessions.values()].map((session) => ({
      ...session,
      lastLine: String(session.lastLine ?? "").slice(0, SUMMARY_LAST_LINE_LIMIT),
    })),
  }
}

/**
 * Sends only over a socket that is actually open.
 *
 * `ws` throws when `send` is called while the socket is still connecting, and this
 * double reconnects on its own — so a timer firing mid-reconnect would take the whole
 * process down instead of being the harmless dropped message it should be.
 */
function sendIfOpen(payload) {
  if (socket?.readyState !== WebSocket.OPEN) return
  socket.send(payload)
}

let summaryRevision = 0
let socket = null

function sendSummary() {
  summaryRevision += 1
  sendIfOpen(JSON.stringify(envelope("mobile.summary", buildSummary())))
}

/*
 * What this stand-in offers as its toolbar, and the buttons the UI tests press.
 *
 * Both text arms are here on purpose: a button that runs its command and one that only
 * types it are the difference the phone has to keep straight, and a mock offering only
 * the first would let that distinction go untested. `Clear` is absent for the reason the
 * real projection leaves it out — it never reaches the terminal.
 */
let toolbarButtons = [
  { id: "enter", label: "回车", group: "key", action: { type: "key", key: "Enter" } },
  { id: "interrupt", label: "Ctrl+C", group: "key", action: { type: "key", key: "Ctrl+C" } },
  { id: "slash-exit", label: "/exit", group: "command", action: { type: "text", text: "/exit", pressEnter: true } },
  { id: "slash-clear", label: "/clear", group: "command", action: { type: "text", text: "/clear", pressEnter: true } },
  { id: "mock-deploy", label: "部署", group: "custom", action: { type: "text", text: "pnpm mock-deploy", pressEnter: true } },
  { id: "mock-port", label: "查端口", group: "custom", action: { type: "text", text: "lsof -i :3001", pressEnter: false } },
]

let toolbarRevision = 0

function sendToolbar() {
  if (toolbarSuppressed) return
  toolbarRevision += 1
  sendIfOpen(JSON.stringify(envelope("mobile.toolbar", {
    desktopClientInstanceId,
    revision: toolbarRevision,
    buttons: toolbarButtons,
  })))
}

/*
 * What this stand-in holds in its 快捷输入 table, and the sentences the UI tests tap.
 *
 * One of them is deliberately long enough that a one-line row cannot show it — the
 * preview is the only way to read the rest, and a mock where every sentence fits would
 * leave both the truncation and the eye button untested.
 *
 * An empty array is a real answer this double can give ("this computer has none"),
 * which is a different answer from never sending the message at all — that is what
 * `--no-toolbar` is for.
 */
let quickPhrases = [
  { id: "mock-log", content: "用 Easy Worklog 初始化今天的工作日志" },
  { id: "mock-commit", content: "这次改动整理成提交说明，中文，说清楚改了什么、为什么改" },
  { id: "mock-review", content: "把这次改动按可读性、边界情况、错误处理三个方面复查一遍" },
]

let quickPhrasesRevision = 0

function sendQuickPhrases() {
  // Suppressed by the same switch as the toolbar, and that is the point of the switch:
  // it stands for a computer from before this whole family existed, so such a computer
  // has never sent either message.
  if (toolbarSuppressed) return
  quickPhrasesRevision += 1
  sendIfOpen(JSON.stringify(envelope("mobile.quickPhrases", {
    desktopClientInstanceId,
    revision: quickPhrasesRevision,
    phrases: quickPhrases,
  })))
}

/**
 * The text this double has "copied", newest first.
 *
 * An empty array is a real answer it can give ("this computer has copied nothing"),
 * which is what the control route is for: unlike the toolbar there is no `--no-*`
 * switch here, because a computer that has never heard of the clipboard and one that
 * has nothing to report are the same thing to a phone — it keeps its own list either
 * way. There is nothing to suppress.
 *
 * The ids are the real thing's shape (the desktop hashes the text) but not its values:
 * nothing on either side recomputes them, they are only how a row is addressed.
 */
let clipboardEntries = [
  { id: "mock-clip-1", text: "pnpm mobile:install", copiedAt: "2026-09-21T10:00:00.000Z" },
  { id: "mock-clip-2", text: "这次改动整理成提交说明，中文，说清楚改了什么", copiedAt: "2026-09-21T09:58:00.000Z" },
]

let clipboardRevision = 0

/**
 * Sent from `sync` and nowhere else, which is the real gateway's rule rather than an
 * omission: the clipboard belongs to the computer, not to any terminal, so a phone
 * opening one is not a reason to be told about it again.
 */
function sendClipboard() {
  clipboardRevision += 1
  sendIfOpen(JSON.stringify(envelope("mobile.clipboard", {
    desktopClientInstanceId,
    revision: clipboardRevision,
    entries: clipboardEntries,
  })))
}

/**
 * Wraps one terminal frame in its envelope.
 *
 * Shared by every sender rather than written out at each: the shape is the gateway's,
 * and a second copy of it is how the two drift apart. `cursor` defaults to the shape a
 * history frame carries — a hidden cursor at the origin — and the senders that move the
 * cursor say so themselves.
 */
function emitFrame(sessionId, frame) {
  sendIfOpen(JSON.stringify(envelope("mobile.frame", {
    desktopClientInstanceId,
    mobileClientInstanceId: currentPhoneId ?? "unknown",
    frame: {
      v: 1,
      sessionId,
      cursor: { row: 0, col: 0, visible: false },
      alt: false,
      truncated: false,
      seq: sessions.get(sessionId)?.lastOutputSeq ?? 1,
      sizeRevision: 1,
      ...frame,
    },
  })))
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
  emitFrame(sessionId, {
    kind: "suffix",
    from,
    lines: lines.map(toWireLine),
    total: all.length,
    cursor: { row: all.length - 1, col: 0, visible: true },
    ...extra,
  })
}

/**
 * The window a phone gets when it opens a terminal.
 *
 * A window ending at the newest line, not the whole buffer: `from` is the gateway index
 * of its first line, and everything below it is what `history` pages back through. On a
 * terminal shorter than the window the two are the same thing, which is why handing over
 * the buffer looked right for as long as it did — and why the paging path could never be
 * reached from a test, since `oldestIndex` was pinned at 0 and the phone had no reason to
 * ask for anything.
 *
 * One frame, because the window is shorter than `maxLinesPerFrame`; the gateway only
 * splits when a snapshot exceeds it.
 */
function sendSnapshot(sessionId) {
  const all = frames.get(sessionId) ?? []
  const from = Math.max(0, all.length - LINE_WINDOW_LINES)
  emitFrame(sessionId, {
    kind: "reset",
    from,
    // The window already fits in one frame; the slice is here so that raising the
    // window above `maxLinesPerFrame` fails visibly here rather than by having the
    // relay cut the connection, which is how this file has been bitten once already.
    lines: all.slice(from, from + MAX_LINES_PER_FRAME).map(toWireLine),
    total: all.length,
    cursor: { row: all.length - 1, col: 0, visible: true },
  })
}

/**
 * One page of scrollback below what the phone already holds.
 *
 * `before` is the client's oldest index, so the page is `[before - count, before)`. An
 * empty page is the honest answer once nothing older is held: the phone reads `from == 0`
 * on a history frame as "this is the top of it" and stops asking, so a double that never
 * answered would leave that state unreachable too.
 */
function sendHistoryPage(sessionId, before, limit) {
  const all = frames.get(sessionId) ?? []
  const requested = Math.max(1, Math.min(limit, MAX_HISTORY_LINES))
  const count = Math.min(requested, before)
  const page = count <= 0 ? [] : all.slice(Math.max(0, before - count), before)
  if (page.length === 0) {
    emitFrame(sessionId, { kind: "history", from: before, lines: [], total: all.length })
    return
  }
  emitFrame(sessionId, {
    kind: "history",
    // `from` describes the lines actually in the frame rather than the ones asked
    // for, which is how the gateway derives it: it has to name the range the phone is
    // about to fill, and a page cut short by the floor names a shorter one.
    from: before - page.length,
    lines: page.map(toWireLine),
    total: all.length,
  })
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
 *
 * One answer the real gateway gives here is left out. It reports a lease `attach` could
 * not take as an accepted result carrying 「另一个客户端正在控制这个终端。」, and this double
 * attaches without it. The reason is the fixture rather than the contract: contention is
 * armed the moment the terminal is opened, so on a real desktop the sentence would come
 * up at the moment the user starts typing, while here it would always be on screen before
 * the test's first keystroke — a notice the reader never asked for, produced by the
 * fixture's timing. Nothing asserts it either way today; a test that wants that screen
 * has to bring the contention in a keystroke later, not read it into `attach`.
 */
const contended = new Set()

function armContention(sessionId) {
  const session = sessions.get(sessionId)
  if (session && contendTitles.includes(session.title)) contended.add(sessionId)
}

/*
 * The computer's answers for a terminal it cannot act on, in the gateway's own words.
 *
 * These are not error handling bolted on for a double's convenience: each sentence is
 * what the reader sees on the phone, and each state is one the phone has to render. A
 * double that answers `accepted` to a terminal that is gone is not being lenient — it
 * is deleting the case from the suite.
 */
function refuseMissing(sessionId) {
  return {
    outcome: "rejected",
    code: "not_found",
    message: "这个终端在电脑上已经不在了。",
    sessionId,
  }
}

/** The refusal for a terminal that is not there *to be opened*: ended, never existed. */
function refuseEnded(sessionId) {
  return {
    outcome: "rejected",
    code: "lifecycle_conflict",
    message: "该终端已结束。",
    sessionId,
  }
}

function refuseUnattached(sessionId) {
  return { outcome: "rejected", code: "not_attached", message: "请先打开这个终端。", sessionId }
}

/**
 * Whether this phone may act on a terminal, or the answer to give back instead.
 *
 * `needsAttachment` is the difference between acting on a terminal and reading it:
 * `history`, `command`, `keys` and `unlock` all require the phone to have it open, and
 * the gateway refuses all four with the same sentence.
 */
function guardSession(sessionId, { needsAttachment = false } = {}) {
  if (!sessions.has(sessionId)) return refuseMissing(sessionId)
  if (needsAttachment && !attached.has(sessionId)) return refuseUnattached(sessionId)
  return null
}

/**
 * Ends a terminal the way the computer's own stop does.
 *
 * The row leaves the list rather than staying in it as an ended one. The stop kills the
 * process, and the process exiting is what takes the session out of the list the summary
 * is built from — the `ended` status exists only inside the desktop's exit handler and
 * never reaches a summary. Leaving a row behind was this double promising the phone a
 * state the real computer never puts it in, and a test that read the phone against it
 * passed while the phone was showing something else entirely.
 */
function stopSession(sessionId) {
  sessions.delete(sessionId)
  frames.delete(sessionId)
  attached.delete(sessionId)
  contended.delete(sessionId)
}

function handleIntent(message) {
  const payload = message.payload
  currentPhoneId = payload.mobileClientInstanceId
  const intent = payload.intent
  const reply = (result) => {
    sendIfOpen(JSON.stringify(envelope("mobile.intentResult", {
      mobileClientInstanceId: payload.mobileClientInstanceId,
      result: { intentId: intent.intentId, ...result },
    })))
  }

  if (intent.kind === "sync") {
    sendSummary()
    // Unconditional, like the real desktop: a phone that has just connected holds
    // nothing, and "unchanged since I last sent it" is not an answer to it.
    sendToolbar()
    sendQuickPhrases()
    sendClipboard()
    // And a fresh window for every terminal this phone holds open, which is how the
    // real gateway answers a client that reconnects — it walks its own attachments and
    // re-pushes each. A double that only sent the summary left a phone returning from a
    // dropped connection holding a half-drawn screen, which is the state the real
    // computer never leaves it in.
    for (const sessionId of [...attached]) {
      if (sessions.has(sessionId)) sendSnapshot(sessionId)
    }
    reply({ outcome: "accepted" })
    return
  }
  if (intent.kind === "ping") {
    reply({ outcome: "no_op" })
    return
  }
  if (intent.kind === "attach") {
    // Opening a terminal that is not there — because it was stopped, deleted, or never
    // existed — is refused, and with the sentence the reader sees on a terminal whose
    // process has exited. Accepting it was the double letting the phone open a screen
    // for a session no computer has.
    if (!sessions.has(intent.sessionId)) {
      reply(refuseEnded(intent.sessionId))
      return
    }
    attached.add(intent.sessionId)
    // Re-armed per attach so a test run is reproducible against a long-lived mock.
    armContention(intent.sessionId)
    sendToolbar()
    sendQuickPhrases()
    // The window goes out before the answer does, which is the gateway's own order:
    // it awaits the snapshot and only then returns the result. Sending the answer first
    // would let the phone be seen working in an order the real computer never produces —
    // the easy one, where a frame never has to be held for a terminal not yet open.
    sendSnapshot(intent.sessionId)
    reply({ outcome: "accepted", sessionId: intent.sessionId })
    return
  }
  if (intent.kind === "detach") {
    // The one intent with no authorisation and no session lookup: the gateway answers
    // it whatever the terminal's state, and the terminal itself is left untouched —
    // the row stays exactly as it was, and only the phone's claim on it goes away.
    attached.delete(intent.sessionId)
    contended.delete(intent.sessionId)
    reply({ outcome: "accepted", sessionId: intent.sessionId })
    return
  }
  if (intent.kind === "history") {
    const refused = guardSession(intent.sessionId, { needsAttachment: true })
    if (refused) {
      reply(refused)
      return
    }
    // Page first, answer second — the order the gateway uses, same as `attach`.
    sendHistoryPage(intent.sessionId, intent.before ?? 0, intent.limit ?? 0)
    reply({ outcome: "accepted", sessionId: intent.sessionId })
    return
  }
  if (intent.kind === "unlock") {
    // How the phone takes the lease back. The gateway clears `leasePreempted`
    // here, so a mock that answered `no_op` would strand the retry.
    const refused = guardSession(intent.sessionId, { needsAttachment: true })
    if (refused) {
      reply(refused)
      return
    }
    contended.delete(intent.sessionId)
    reply({ outcome: "accepted", sessionId: intent.sessionId })
    return
  }
  if (intent.kind === "command" || intent.kind === "keys") {
    // A write goes to a terminal the phone has open, and to one that is still there.
    // Both refusals come before the lease, which is the order the gateway checks them.
    const refused = guardSession(intent.sessionId, { needsAttachment: true })
    if (refused) {
      reply(refused)
      return
    }
    if (contended.has(intent.sessionId)) {
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
    // Echoed so a test can see which key arrived rather than only that something did.
    // A name is all this double can print — the bytes are the real desktop's business,
    // and are pinned by the terminal capability's own tests.
    const described = (intent.actions ?? [])
      .map((action) => action.type === "key" ? `key:${action.key}` : `text:${action.text}`)
      .join(" ")
    if (described) {
      const current = frames.get(intent.sessionId) ?? []
      sendFrame(intent.sessionId, current.length, [`[mock] keys ${described}`])
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
  if (intent.kind === "fileUpload") {
    /*
     * A file the phone has already put in the drive, to be brought down and named in the
     * terminal. The real desktop fetches the bytes over HTTP and writes them next to the
     * session's directory; what this double reproduces is the part the phone depends on,
     * which is the answer: where the file landed is the computer's fact and the phone
     * cannot derive it. It is also what the phone undoes the insertion with.
     */
    const session = sessions.get(intent.sessionId)
    const landedPath = `${session?.cwd ?? "/tmp"}/${intent.fileName}`
    /*
     * The bytes land either way. What can fail is naming the path in the terminal, and
     * the gateway reports that as an `accepted` result carrying the fact rather than as
     * a refusal — the file really is on the computer, and the phone has to be able to
     * say so while offering the way back. A double that could only ever succeed made
     * that whole screen unreachable from a test.
     */
    if (!session || !attached.has(intent.sessionId)) {
      reply({
        outcome: "accepted",
        sessionId: intent.sessionId,
        landedPath,
        message: "文件已落到电脑，但这个终端已经不在了，路径没有插入。",
      })
      return
    }
    const current = frames.get(intent.sessionId) ?? []
    sendFrame(intent.sessionId, current.length, [`$ echo ${landedPath}`])
    sendSummary()
    reply({ outcome: "accepted", sessionId: intent.sessionId, landedPath })
    return
  }
  if (intent.kind === "rename") {
    const session = sessions.get(intent.sessionId)
    if (!session) {
      reply(refuseMissing(intent.sessionId))
      return
    }
    session.title = intent.title
    sendSummary()
    reply({ outcome: "accepted", sessionId: intent.sessionId })
    return
  }
  if (intent.kind === "delete") {
    // A live terminal cannot be deleted directly on the real desktop either: the
    // gateway stops it, and the PTY exiting is what removes it. Either way the
    // phone's row ends up gone, which is the part this double reproduces. Whether
    // the gateway picks stop or delete is covered by the gateway's own tests.
    //
    // A terminal that is already gone is a no-op *success* here, unlike `stop`: the
    // state this intent asks for is the one it is already in.
    if (sessions.has(intent.sessionId)) stopSession(intent.sessionId)
    sendSummary()
    reply({ outcome: "accepted", sessionId: intent.sessionId })
    return
  }
  if (intent.kind === "stop") {
    if (!sessions.has(intent.sessionId)) {
      reply(refuseMissing(intent.sessionId))
      return
    }
    stopSession(intent.sessionId)
    sendSummary()
    reply({ outcome: "accepted", sessionId: intent.sessionId })
    return
  }
  if (intent.kind === "stopAll") {
    // Only the terminals *this phone* has open, not everything on the computer: the
    // gateway walks its own attachment list for the client that asked. A double that
    // stopped the lot would let a test pass over a phone that had stopped something
    // it never opened.
    for (const sessionId of [...attached]) stopSession(sessionId)
    sendSummary()
    reply({ outcome: "accepted" })
    return
  }
  if (intent.kind === "resize") {
    const session = sessions.get(intent.sessionId)
    if (!session) {
      reply(refuseMissing(intent.sessionId))
      return
    }
    // The phone's claim on the grid, recorded the way the gateway records it: the
    // summary names the owner, and the desktop stops refitting this terminal to its
    // own layout while the claim stands. No lease is involved in either direction —
    // sizing is not writing.
    if (intent.cols) session.cols = intent.cols
    if (intent.rows) session.rows = intent.rows
    session.gridOwnerId = payload.mobileClientInstanceId
    sendSummary()
    reply({ outcome: "accepted", sessionId: intent.sessionId })
    return
  }
  if (intent.kind === "releaseGrid") {
    const session = sessions.get(intent.sessionId)
    if (!session) {
      reply(refuseMissing(intent.sessionId))
      return
    }
    // Giving back a grid nobody claimed is a success, not a refusal. The gateway's
    // own `desktop_grid_unknown` is for the narrower case of ownership it has no
    // desktop grid to restore — a state this double cannot be in, and inventing a
    // way into it would be the same mistake in the other direction.
    delete session.gridOwnerId
    sendSummary()
    reply({ outcome: "accepted", sessionId: intent.sessionId })
    return
  }
  /*
   * A kind this double does not stand in for.
   *
   * Never `no_op`: that reads on the phone as "the computer did nothing", which is an
   * answer it acts on, and it is how an entire flow gets tested against silence. Naming
   * the double instead makes a test that needs one fail saying so. The kinds left out
   * are `create`, `createAgentConversation` and `launchCommand` — the New Terminal panel,
   * which needs the project and Provider lists this summary does not carry, and which the
   * real-desktop suite exercises against a real computer anyway.
   */
  console.error(
    `mock desktop received an intent it does not implement: ${intent.kind}`
    + " — see this file's header for the kinds it stands in for",
  )
  reply({
    outcome: "rejected",
    code: "mock_unimplemented_intent",
    message: `模拟桌面端还没有实现 ${intent.kind}，请用真机用例覆盖。`,
  })
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
    /*
     * Replaces this double's command list — add, rename and delete all end up here,
     * because all three are "the list is now this".
     *
     * Sent straight away, which the real desktop does not do: it pushes on a phone's
     * sync, on an attach, and on the summary tick, never on the edit itself. The
     * difference is only in *when* a snapshot arrives, which is the desktop's business
     * and is covered by its own tests — what is being driven from here is the phone,
     * and the phone does the same thing with the snapshot whenever it lands.
     */
    if (route === "/desktop/toolbar") {
      let body = ""
      request.on("data", (chunk) => { body += chunk })
      request.on("end", () => {
        try {
          const parsed = JSON.parse(body || "[]")
          if (!Array.isArray(parsed)) throw new Error("expected an array of buttons")
          toolbarButtons = parsed
          sendToolbar()
          response.writeHead(200).end("ok")
        } catch (error) {
          response.writeHead(400).end(String(error?.message ?? error))
        }
      })
      return
    }
    /*
     * Replaces this double's 快捷输入 table. Sent straight away, for the reason the
     * toolbar route gives: what is being driven from here is the phone, and it does the
     * same thing with a snapshot whenever it lands.
     */
    /*
     * Replaces what this double has "copied". Sent straight away, for the reason the
     * quick-phrases route gives: what is being driven from here is the phone, and it
     * merges a snapshot into its own list whenever one lands.
     */
    if (route === "/desktop/clipboard") {
      let body = ""
      request.on("data", (chunk) => { body += chunk })
      request.on("end", () => {
        try {
          const parsed = JSON.parse(body || "[]")
          if (!Array.isArray(parsed)) throw new Error("expected an array of entries")
          clipboardEntries = parsed
          sendClipboard()
          response.writeHead(200).end("ok")
        } catch (error) {
          response.writeHead(400).end(String(error?.message ?? error))
        }
      })
      return
    }
    if (route === "/desktop/quick-phrases") {
      let body = ""
      request.on("data", (chunk) => { body += chunk })
      request.on("end", () => {
        try {
          const parsed = JSON.parse(body || "[]")
          if (!Array.isArray(parsed)) throw new Error("expected an array of phrases")
          quickPhrases = parsed
          sendQuickPhrases()
          response.writeHead(200).end("ok")
        } catch (error) {
          response.writeHead(400).end(String(error?.message ?? error))
        }
      })
      return
    }
    response.writeHead(404).end()
  })
  server.listen(port, controlHost, () => {
    console.log(`mock desktop control listening on http://${controlHost}:${port}`)
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
      deviceName: desktopName,
    })))
  })
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw))
    if (message.type === "live.welcome") {
      console.log(`mock desktop online as ${desktopClientInstanceId}`)
      sendSummary()
      sendToolbar()
      sendQuickPhrases()
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

// Kept apart from the fixtures the other tests read, so ending it costs nobody else.
makeSession(scratchSessionId, "scratch", "/Users/liy/code/scratch", [`$ sleep 30`, ""])

// A plain shell, for the file relay: submitting a path into it is harmless, which is
// what `TerminalFileRelayUITests` needs to send a file to. It is addressed by title
// through `SYNAPSE_TEST_SESSION_TITLE`, and this is that title's default.
makeSession(relaySessionId, "relay-test", "/Users/liy/code/relay", [`$ echo ready`, ""])

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
