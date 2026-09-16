/**
 * End-to-end smoke test for the mobile terminal relay.
 *
 * Acts as both a desktop and a phone against a running server and drives the
 * full routing path: phone intent → desktop, desktop summary/frame/result →
 * phone, plus the offline-desktop answer and the detach signal. It exercises the
 * real websocket upgrade, the real access-token verification, and the real
 * relay, which is the part unit tests fake out.
 *
 * Usage: node test/mobile-relay-smoke.mjs [baseUrl]
 */

import { randomUUID } from "node:crypto"
import WebSocket from "ws"

const baseUrl = process.argv[2] ?? "http://127.0.0.1:3001"
const wsUrl = baseUrl.replace(/^http/, "ws")

const failures = []
let checks = 0

function check(label, condition, detail) {
  checks += 1
  if (condition) {
    console.log(`  ok   ${label}`)
    return
  }
  failures.push(label)
  console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${detail}`}`)
}

async function post(path, body, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let parsed
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  return { status: response.status, body: parsed }
}

async function get(path, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

async function ensureAccount() {
  const suffix = randomUUID().slice(0, 8)
  const email = `mobile-smoke-${suffix}@example.invalid`
  const password = `Smoke-${suffix}-Passw0rd`
  const registered = await post("/api/auth/register", {
    email,
    handle: `smoke${suffix}`,
    password,
  })
  if (registered.status >= 400) {
    throw new Error(`register failed: ${registered.status} ${JSON.stringify(registered.body)}`)
  }
  const loggedIn = await post("/api/auth/login", { email, password })
  if (loggedIn.status >= 400 || !loggedIn.body?.accessToken) {
    throw new Error(`login failed: ${loggedIn.status} ${JSON.stringify(loggedIn.body)}`)
  }
  return { email, accessToken: loggedIn.body.accessToken }
}

/** Opens an authenticated live socket and waits for the welcome handshake. */
function connect(path, token, clientInstanceId, platform) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${wsUrl}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const received = []
    const waiters = []

    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw))
      if (message.type === "live.welcome") return
      const index = waiters.findIndex((waiter) => waiter.match(message))
      if (index >= 0) {
        const [waiter] = waiters.splice(index, 1)
        clearTimeout(waiter.timer)
        waiter.resolve(message)
        return
      }
      received.push(message)
    })
    socket.on("error", reject)
    socket.on("unexpected-response", (_request, response) => {
      reject(new Error(`upgrade rejected with ${response.statusCode}`))
    })
    socket.on("open", () => {
      socket.send(JSON.stringify(envelope("live.hello", {
        clientInstanceId,
        appVersion: "0.0.0-smoke",
        platform,
        deviceName: platform === "ios" ? "Smoke iPhone" : "Smoke Mac",
      })))
      resolve({
        socket,
        received,
        send: (type, payload) => socket.send(JSON.stringify(envelope(type, payload))),
        waitFor(match, timeoutMs = 4000) {
          const existing = received.findIndex(match)
          if (existing >= 0) return Promise.resolve(received.splice(existing, 1)[0])
          return new Promise((waiterResolve, waiterReject) => {
            const waiter = {
              match,
              resolve: waiterResolve,
              timer: setTimeout(() => {
                waiters.splice(waiters.indexOf(waiter), 1)
                waiterReject(new Error("timed out waiting for a message"))
              }, timeoutMs),
            }
            waiters.push(waiter)
          })
        },
      })
    })
  })
}

function envelope(type, payload) {
  return { type, id: randomUUID(), sentAt: new Date().toISOString(), payload }
}

async function main() {
  console.log(`\nMobile relay smoke test against ${baseUrl}\n`)

  console.log("auth")
  const account = await ensureAccount()
  check("registered and logged in", Boolean(account.accessToken))

  const desktopId = `smoke-desktop-${randomUUID().slice(0, 8)}`
  const phoneId = `smoke-phone-${randomUUID().slice(0, 8)}`

  console.log("\nconnections")
  const desktop = await connect("/api/live/desktop", account.accessToken, desktopId, "darwin-arm64")
  const phone = await connect("/api/live/mobile", account.accessToken, phoneId, "ios")
  check("desktop socket connected", desktop.socket.readyState === WebSocket.OPEN)
  check("phone socket connected", phone.socket.readyState === WebSocket.OPEN)

  console.log("\ndevice presence")
  const desktops = await get("/api/mobile/desktops", account.accessToken)
  check("phone can see the desktop", desktops.body?.clientInstanceIds?.includes(desktopId), JSON.stringify(desktops.body))

  console.log("\nphone → desktop routing")
  phone.send("mobile.intent", {
    desktopClientInstanceId: desktopId,
    mobileClientInstanceId: phoneId,
    intent: { v: 1, intentId: "smoke-intent-1", kind: "attach", sessionId: "00000000-0000-4000-8000-000000000001" },
  })
  const delivered = await desktop.waitFor((message) => message.type === "mobile.intent")
  check("desktop received the intent", delivered.payload.intent.intentId === "smoke-intent-1")
  check("intent kept its mobile origin", delivered.payload.mobileClientInstanceId === phoneId)

  console.log("\ndesktop → phone routing")
  desktop.send("mobile.summary", {
    desktopClientInstanceId: desktopId,
    desktopName: "Smoke Mac",
    revision: 1,
    groups: [{ id: "11111111-1111-4111-8111-111111111111", name: "Smoke" }],
    sessions: [{
      id: "00000000-0000-4000-8000-000000000001",
      groupId: "11111111-1111-4111-8111-111111111111",
      title: "dev-server",
      status: "running",
      attention: { state: "waiting", kind: "approval" },
      cwd: "/tmp/smoke",
      cols: 80,
      rows: 24,
      startedAt: new Date().toISOString(),
      lastLine: "Do you want to proceed?",
      lastOutputSeq: 3,
    }],
  })
  const summary = await phone.waitFor((message) => message.type === "mobile.summary")
  check("phone received the summary", summary.payload.sessions?.[0]?.title === "dev-server")
  check(
    "attention survives the relay",
    summary.payload.sessions?.[0]?.attention?.state === "waiting",
  )

  desktop.send("mobile.frame", {
    desktopClientInstanceId: desktopId,
    mobileClientInstanceId: phoneId,
    frame: {
      v: 1,
      sessionId: "00000000-0000-4000-8000-000000000001",
      kind: "suffix",
      from: 2,
      lines: [["hello from the desktop"], ["second line", [[0, 6, 2, -1, 1]]]],
      total: 4,
      cursor: { row: 3, col: 0, visible: true },
      alt: false,
      truncated: false,
      seq: 9,
      sizeRevision: 1,
    },
  })
  const frame = await phone.waitFor((message) => message.type === "mobile.frame")
  check("phone received the frame", frame.payload.frame.lines?.[0]?.[0] === "hello from the desktop")
  check("style runs survive the relay", Array.isArray(frame.payload.frame.lines?.[1]?.[1]))

  desktop.send("mobile.intentResult", {
    mobileClientInstanceId: phoneId,
    result: { intentId: "smoke-intent-1", outcome: "accepted", sessionId: "00000000-0000-4000-8000-000000000001" },
  })
  const result = await phone.waitFor((message) => message.type === "mobile.intentResult")
  check("phone received the intent result", result.payload.result.outcome === "accepted")

  console.log("\nsummary cache for cold start")
  const cached = await get(`/api/mobile/summary?desktopClientInstanceId=${desktopId}`, account.accessToken)
  check("cached summary is served over HTTP", cached.body?.summary?.sessions?.[0]?.title === "dev-server", JSON.stringify(cached.body)?.slice(0, 160))

  console.log("\nREST intent fallback, desktop offline")
  const offline = await post("/api/mobile/terminal/intent", {
    clientInstanceId: phoneId,
    desktopClientInstanceId: "smoke-desktop-that-does-not-exist",
    intent: { v: 1, intentId: "smoke-intent-2", kind: "sync" },
  }, account.accessToken)
  check("offline desktop is reported, not retried", offline.body?.delivered === false)
  check("offline code is specific", offline.body?.code === "desktop_offline", JSON.stringify(offline.body))

  console.log("\nREST intent fallback, desktop online")
  const online = await post("/api/mobile/terminal/intent", {
    clientInstanceId: phoneId,
    desktopClientInstanceId: desktopId,
    intent: { v: 1, intentId: "smoke-intent-3", kind: "ping" },
  }, account.accessToken)
  check("online desktop accepts delivery", online.body?.delivered === true, JSON.stringify(online.body))
  const restDelivered = await desktop.waitFor((message) => message.type === "mobile.intent"
    && message.payload.intent.intentId === "smoke-intent-3")
  check("desktop received the REST-submitted intent", restDelivered.payload.intent.kind === "ping")

  console.log("\ndetach signal")
  phone.socket.close()
  const detached = await desktop.waitFor((message) => message.type === "mobile.detached")
  check("desktop is told the phone went away", detached.payload.mobileClientInstanceId === phoneId)

  console.log("\naccess control")
  const anonymous = await get("/api/mobile/desktops")
  check("mobile endpoints require auth", anonymous.status === 401)

  desktop.socket.close()

  console.log(`\n${checks - failures.length}/${checks} checks passed`)
  if (failures.length > 0) {
    console.log(`failed: ${failures.join(", ")}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error("\nsmoke test crashed:", error)
  process.exitCode = 1
})
