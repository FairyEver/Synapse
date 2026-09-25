/**
 * A stand-in gateway for the mobile drive (云盘) end-to-end test.
 *
 * `server/test/mock-desktop.mjs` stands in for the desktop; this one stands in for the
 * **server**, which is what the drive screens need: the browse tree, trash, shares,
 * public assets, uploads and the login that every one of them sits behind. It exists so
 * that `SynapseMobileUITests/DriveAcceptanceUITests.swift` can drive the drive screens
 * against a real network, real decoding and real rendering on a machine that holds no
 * usable account credentials.
 *
 * The app is not modified for it: `AppConfiguration.apiBaseURL` reads `UserDefaults`, and
 * the test overrides it with the `-SynapseAPIBaseURL http://127.0.0.1:8787/api` launch
 * argument — the same lever `TerminalFlowUITests` uses.
 *
 * Usage: node server/test/mock-drive-server.mjs [port]      (default 8787)
 *
 * Every request logs one `METHOD path -> status` line, to line this up against the app's
 * log when something does not appear on screen.
 *
 * What this double stands in for, and what it does not.
 *
 * It answers the drive endpoints with an in-memory tree whose shapes and refusal codes are
 * copied from the gateway's own answers, because a test that reads the phone against a
 * state the real server never produces is green about nothing. Two things it deliberately
 * does **not** stand in for, both of which the caller has to keep in mind:
 *
 *  - **Authentication is not verified.** `/auth/login` answers any credentials with a
 *    three-part token whose signature is not checked (`APIClient` only reads `exp` from the
 *    payload). Nothing here can tell you whether real sign-in or refresh works.
 *  - **Bytes are canned.** Previews and downloads return a fixed string; sizes and visit
 *    counts are made up. Uploads record the name and size but never see the payload.
 *
 * So it is the right double for "does this screen do the right thing with the answer" and
 * the wrong one for "is the answer correct".
 */

import { createHash, randomUUID } from "node:crypto"
import { createServer } from "node:http"

const port = Number(process.argv[2] ?? 8787)

// MARK: - 内存里的那棵树

const now = () => new Date().toISOString()

function item(id, name, type, size = "0", mimeType = null, previewKind = "download-only") {
  return {
    id,
    name,
    type,
    size,
    mimeType,
    updatedAt: now(),
    previewKind,
    browserUrl: `/drive/browser/owner/items/${id}`,
    downloadUrl: type === "file" ? `http://127.0.0.1:${port}/drive/items/${id}/download` : null,
    shareUrl: null,
  }
}

/** 每一项的父亲，以及它的孩子（按插入顺序）。 */
let children = new Map()
let parents = new Map()
let seq = 0
const nextId = (prefix) => `${prefix}-${(seq += 1)}`

/** 名字在这一条里的项，移动一定失败。验收「部分失败」那一条要用它。 */
let failMove = process.env.STUB_FAIL_MOVE ?? null

/// 上传的字节落进假网关之前先等这么久（毫秒）。
///
/// 验收第 8 条（picker 交回来的文件落在哪）要在一个「文件已经落到磁盘、还没传完」的
/// 窗口里去 App 容器里看那份拷贝
/// 落在哪 —— 假网关答得太快，那个窗口就不存在。
let slowMs = 0

function add(parentId, child) {
  if (!children.has(parentId)) children.set(parentId, [])
  children.get(parentId).push(child)
  parents.set(child.id, parentId)
  return child
}

let root
let trash = []
let shares = []
let prepared = new Map()

/// 每一轮验收都从同一棵树开始。
///
/// 用例之间共享这一个进程，而树是内存里的：不重置的话，前一条用例改掉的名字、删掉的
/// 东西会一路带到后面几条上，后面的断言就在说别人的状态。
function reset(options = {}) {
  children = new Map()
  parents = new Map()
  seq = 0
  trash = []
  shares = []
  prepared = new Map()
  failMove = options.failMove ?? null

  root = item("root", "网盘", "folder")
  add("root", item(nextId("f"), "工作", "folder"))
  add("root", item(nextId("f"), "项目", "folder"))
  add("root", item(nextId("i"), "readme.md", "file", "2048", "text/markdown", "markdown"))

  const work = children.get("root")[0]
  add(work.id, item(nextId("f"), "2026", "folder"))
  add(work.id, item(nextId("i"), "周报.md", "file", "1024", "text/markdown", "markdown"))

  const year = children.get(work.id)[0]
  add(year.id, item(nextId("f"), "归档", "folder"))
  add(year.id, item(nextId("i"), "计划.md", "file", "512", "text/markdown", "markdown"))

  const archive = children.get(year.id)[0]
  add(archive.id, item(nextId("i"), "旧文档.md", "file", "256", "text/markdown", "markdown"))

  const project = children.get("root")[1]
  add(project.id, item(nextId("i"), "notes.md", "file", "4096", "text/markdown", "markdown"))
  add(project.id, item(nextId("f"), "素材", "folder"))
}

reset()

/** 一个文件夹到根的链路（面包屑用）。 */
function chainTo(id) {
  const chain = []
  let cursor = id
  while (cursor) {
    const node = cursor === "root" ? root : find(cursor)
    if (!node) break
    chain.unshift(node)
    cursor = parents.get(cursor)
  }
  return chain
}

function find(id) {
  if (id === "root") return root
  for (const list of children.values()) {
    const hit = list.find((entry) => entry.id === id)
    if (hit) return hit
  }
  return null
}


// MARK: - 响应

function previewOf(node) {
  if (node.type === "folder") return null
  if (node.previewKind === "markdown" || node.previewKind === "text") {
    return {
      kind: node.previewKind,
      text: `# ${node.name}\n\n这是假网关给的一段正文。\n`,
      html: null,
      truncated: false,
      imageUrl: null,
      visitUrl: null,
    }
  }
  return { kind: node.previewKind, text: null, html: null, truncated: false, imageUrl: null, visitUrl: null }
}

function snapshot(nodeId) {
  const node = nodeId === "root" ? root : find(nodeId)
  if (!node) return null
  const kids = children.get(node.id) ?? []
  return {
    current: node,
    breadcrumbs: chainTo(node.id).map((entry) => ({
      id: entry.id,
      name: entry.name,
      browserUrl: entry.browserUrl,
    })),
    children: kids,
    childrenPage: { offset: 0, limit: 100, hasMore: false, nextOffset: null },
    preview: previewOf(node),
    canDownload: node.type === "file",
    canZip: node.type === "folder",
  }
}

function page(items) {
  return { offset: 0, limit: 100, hasMore: false, nextOffset: null, items }
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8")
      try {
        resolve(text ? JSON.parse(text) : {})
      } catch {
        resolve({})
      }
    })
  })
}

function json(response, status, body) {
  const payload = body === undefined ? "" : JSON.stringify(body)
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  })
  response.end(payload)
}

/** 三段式假 JWT：`APIClient.expiry(of:)` 只读 payload 里的 `exp`，签名不验。 */
function token() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url")
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({
    sub: "stub-account",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.stub`
}

// MARK: - 路由

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`)
  const path = url.pathname.replace(/^\/api/, "")
  const method = request.method ?? "GET"
  const body = await readBody(request)
  let status = 200

  const send = (code, payload) => {
    status = code
    json(response, code, payload)
  }

  try {
    // 用例之间的重置。不是产品接口，只服务这套端到端用例。
    if (path === "/__reset") {
      reset(body ?? {})
      slowMs = 0
      return send(200, { ok: true, failMove })
    }

    // 让上传慢下来，好让验收第 8 条（picker 落点）有一个能去容器里看的窗口。
    if (path === "/__slow") {
      slowMs = Number(body.ms ?? 0)
      return send(200, { slowMs })
    }

    // 认证
    if (path === "/auth/login" || path === "/auth/refresh") {
      return send(200, { accessToken: token(), refreshToken: "stub-refresh" })
    }
    if (path === "/auth/logout") return send(200, {})

    // 手机端杂项：这些不参与云盘，给一份空的，别让它们把界面染红
    if (path === "/mobile/desktops") return send(200, { clientInstanceIds: [], desktops: [] })
    if (path === "/mobile/devices") return send(200, {})
    if (path.startsWith("/mobile/devices/")) return send(200, {})
    if (path === "/mobile/summary") return send(200, { summary: null })
    if (path.startsWith("/notifications")) {
      if (path === "/notifications/count") return send(200, { count: 0, unread: 0 })
      return send(200, { items: [], total: 0, page: { offset: 0, limit: 50, hasMore: false, nextOffset: null } })
    }
    if (path === "/meetings") return send(200, { meetings: [], total: 0 })
    if (path.startsWith("/voice/asr")) return send(200, { asrEnabled: false })

    // 云盘：浏览
    if (path === "/drive/browser/owner/root") return send(200, snapshot("root"))
    const browser = path.match(/^\/drive\/browser\/owner\/items\/([^/]+)$/)
    if (browser) {
      const shot = snapshot(decodeURIComponent(browser[1]))
      if (!shot) return send(404, { message: "没有这一项" })
      return send(200, shot)
    }
    const inspect = path.match(/^\/drive\/browser\/owner\/items\/([^/]+)\/content\/inspect$/)
    if (inspect) {
      const node = find(decodeURIComponent(inspect[1]))
      if (!node) return send(404, { message: "没有这一项" })
      return send(200, {
        itemId: node.id,
        name: node.name,
        kind: node.previewKind === "download-only" ? "text" : node.previewKind,
        sizeBytes: Number(node.size),
        versionId: "v1",
        editable: true,
      })
    }
    const chunk = path.match(/^\/drive\/browser\/owner\/items\/([^/]+)\/content$/)
    if (chunk) {
      const node = find(decodeURIComponent(chunk[1]))
      if (!node) return send(404, { message: "没有这一项" })
      return send(200, {
        itemId: node.id,
        versionId: "v1",
        text: `# ${node.name}\n\n这是假网关给的一段正文。\n`,
        startByte: 0,
        endByte: 32,
        totalBytes: 32,
        nextCursor: null,
        endOfFile: true,
      })
    }

    // 云盘：用量
    if (path === "/drive/usage") {
      return send(200, { usedBytes: "4096", reservedBytes: "0", quotaBytes: "10737418240" })
    }

    // 云盘：新建文件夹
    if (path === "/drive/folders" && method === "POST") {
      const created = add(body.parentId ?? "root", item(nextId("f"), body.name ?? "新建文件夹", "folder"))
      return send(200, created)
    }

    // 云盘：改名 / 移动 / 删除
    const driveItem = path.match(/^\/drive\/items\/([^/]+)$/)
    if (driveItem) {
      const node = find(decodeURIComponent(driveItem[1]))
      if (!node) return send(404, { message: "没有这一项" })
      if (method === "PATCH") {
        // 验收「部分失败」那一条：点名的那一项移动一定失败，别的照常。
        if ("parentId" in body && failMove && node.name === failMove) {
          return send(500, { message: `stub 拒了「${node.name}」的移动` })
        }
        if (typeof body.name === "string") node.name = body.name
        if ("parentId" in body) {
          const from = parents.get(node.id)
          children.set(from, (children.get(from) ?? []).filter((entry) => entry.id !== node.id))
          const to = body.parentId ?? "root"
          if (!children.has(to)) children.set(to, [])
          children.get(to).push(node)
          parents.set(node.id, to)
        }
        return send(200, node)
      }
      if (method === "DELETE") {
        const from = parents.get(node.id)
        children.set(from, (children.get(from) ?? []).filter((entry) => entry.id !== node.id))
        trash.push({
          id: node.id,
          kind: "normal",
          name: node.name,
          type: node.type,
          size: node.size,
          mimeType: node.mimeType,
          originalPath: `/${chainTo(from ?? "root").map((entry) => entry.name).join("/")}`,
          assetId: null,
          trashedAt: now(),
        })
        return send(200, {})
      }
    }

    // 云盘：回收站
    if (path === "/drive/trash" && method === "GET") {
      return send(200, { items: trash, total: trash.length, page: { offset: 0, limit: 100, hasMore: false, nextOffset: null } })
    }
    const restore = path.match(/^\/drive\/items\/([^/]+)\/restore$/)
    if (restore) {
      const id = decodeURIComponent(restore[1])
      const index = trash.findIndex((entry) => entry.id === id)
      if (index < 0) return send(404, { message: "回收站里没有它" })
      const [entry] = trash.splice(index, 1)
      const node = item(entry.id, entry.name, entry.type, entry.size, entry.mimeType)
      add("root", node)
      return send(200, {})
    }
    const trashEntry = path.match(/^\/drive\/trash\/([^/]+)$/)
    if (trashEntry && method === "DELETE") {
      const index = trash.findIndex((entry) => entry.id === decodeURIComponent(trashEntry[1]))
      if (index >= 0) trash.splice(index, 1)
      return send(200, {})
    }

    // 云盘：分享
    if (path === "/drive/shares" && method === "GET") return send(200, { ...page(shares), page: { offset: 0, limit: 100, hasMore: false, nextOffset: null } })
    const shareCreate = path.match(/^\/drive\/items\/([^/]+)\/share$/)
    if (shareCreate && method === "POST") {
      const node = find(decodeURIComponent(shareCreate[1]))
      if (!node) return send(404, { message: "没有这一项" })
      const existing = shares.find((entry) => entry.itemId === node.id)
      const share = {
        id: existing?.id ?? `share-${shares.length + 1}`,
        shareId: existing?.shareId ?? `s${shares.length + 1}`,
        itemId: node.id,
        itemName: node.name,
        itemType: node.type,
        sourceDeleted: false,
        enabled: true,
        url: `http://127.0.0.1:${port}/s/${existing?.shareId ?? `s${shares.length + 1}`}`,
        urlWithPassword: `http://127.0.0.1:${port}/s/${existing?.shareId ?? `s${shares.length + 1}`}?p=abcd`,
        passwordEnabled: body.passwordEnabled === true,
        password: body.passwordEnabled === true ? "abcd" : null,
        expiresAt: null,
        accessMode: body.accessMode ?? "link_read",
        editorEmails: [],
        createdAt: now(),
      }
      if (existing) shares[shares.indexOf(existing)] = share
      else shares.push(share)
      node.shareUrl = share.url
      return send(200, share)
    }
    const shareRecord = path.match(/^\/drive\/shares\/([^/]+)$/)
    if (shareRecord) {
      const id = decodeURIComponent(shareRecord[1])
      const index = shares.findIndex((entry) => entry.id === id || entry.shareId === id)
      if (index < 0) return send(404, { message: "没有这条分享" })
      if (method === "DELETE") {
        const [removed] = shares.splice(index, 1)
        const node = find(removed.itemId)
        if (node) node.shareUrl = null
        return send(200, {})
      }
      return send(200, shares[index])
    }

    // 云盘：公开素材
    if (path === "/drive/public-assets" && method === "GET") return send(200, { items: [], total: 0, page: { offset: 0, limit: 100, hasMore: false, nextOffset: null } })

    // 云盘：上传
    if (path === "/drive/uploads/prepare" && method === "POST") {
      const sessionId = randomUUID()
      const parentId = body.parentId ?? "root"
      if (!children.has(parentId)) children.set(parentId, [])
      const created = item(nextId("i"), body.name ?? "上传的文件", "file", String(body.size ?? 0), body.mimeType ?? null, "download-only")
      children.get(parentId).push(created)
      parents.set(created.id, parentId)
      prepared.set(sessionId, created)
      return send(200, {
        sessionId,
        item: created,
        upload: {
          method: "PUT",
          url: `http://127.0.0.1:${port}/api/drive/uploads/${sessionId}/bytes`,
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
          headers: {},
        },
        overwrite: null,
      })
    }
    const bytes = path.match(/^\/drive\/uploads\/([^/]+)\/bytes$/)
    if (bytes && (method === "PUT" || method === "POST")) {
      if (slowMs > 0) await new Promise((resolve) => setTimeout(resolve, slowMs))
      return send(200, {})
    }
    const complete = path.match(/^\/drive\/uploads\/([^/]+)\/complete$/)
    if (complete) {
      const created = prepared.get(decodeURIComponent(complete[1]))
      return send(200, { id: created?.id ?? "unknown", name: created?.name ?? "", size: created?.size ?? "0" })
    }
    const cancel = path.match(/^\/drive\/uploads\/([^/]+)\/cancel$/)
    if (cancel) return send(200, {})

    // 给验收第 8 条（picker 落点）准备一份素材：把它取下来放进模拟器的「文件」里
    // （`group.com.apple.FileProvider.LocalStorage` 的 `File Provider Storage/`，
    // 取法见 `SynapseMobileUITests/DriveAcceptanceUITests.swift` 的头注释），
    // 那两条用例才有一条真能从「文件」App 里挑的东西。
    if (path === "/__sample-file.txt") {
      const payload = "task 10 acceptance sample\n"
      response.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": 'attachment; filename="task10-sample.txt"',
        "content-length": Buffer.byteLength(payload),
      })
      return response.end(payload)
    }

    // 下载那些落点（导出用；这一轮不走）
    if (path.includes("/download")) {
      response.writeHead(200, { "content-type": "application/octet-stream" })
      return response.end("stub")
    }

    return send(404, { message: `stub 没有实现 ${method} ${path}` })
  } finally {
    console.log(`${method} ${path} -> ${status}`)
  }
})


// 一个最小的 websocket 握手：连接建起来之后不发任何东西，客户端那套重连逻辑就不会
// 因为「连不上」而在日志里刷屏。
server.on("upgrade", (request, socket) => {
  const key = request.headers["sec-websocket-key"]
  if (!key) return socket.destroy()
  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64")
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  )
  socket.on("error", () => {})
  socket.on("data", () => {}) // 客户端帧不回，客户端只发 hello 与心跳
  console.log(`WS ${request.url} -> 101`)
})

server.listen(port, "127.0.0.1", () => console.log(`mock drive server on http://127.0.0.1:${port}/api`))
