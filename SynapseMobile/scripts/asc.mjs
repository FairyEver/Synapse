#!/usr/bin/env node
// Read-only App Store Connect queries for the SynapseMobile release flow.
//
//   node SynapseMobile/scripts/asc.mjs app          # 凭证自检，列出 app
//   node SynapseMobile/scripts/asc.mjs builds       # 近期构建：处理状态、挂了哪些群组
//   node SynapseMobile/scripts/asc.mjs next-build   # 各版本已用到的号
//
// Deliberately read-only. Everything that writes -- uploading a build, changing
// a deployed setting -- already has its own script (release-ios.sh, deploy.sh)
// where it is reviewable as a whole, and one of them restarts production. This
// one exists so the agent can *see* what App Store Connect thinks, instead of
// inferring it from an error message after something already failed.
//
// No third-party dependencies: an ES256 JWT is small enough to sign with
// node:crypto, and that keeps a credential-bearing script auditable in one read.
//
// Credentials come from SynapseMobile/.env.asc (gitignored; see env.asc.example).
// That file is the only source -- no environment-variable fallback, so when
// something is wrong there is exactly one place to look.
import { readFileSync } from "node:fs"
import { sign } from "node:crypto"

const APP_ID = "6812813608" // Synapse Remote; not a secret, just this app's identity
const CREDENTIALS = new URL("../.env.asc", import.meta.url)
const TEMPLATE = new URL("../env.asc.example", import.meta.url)

const usage = `usage: asc.mjs <app|builds|next-build>

  app         凭证自检：列出这个账号下的 app
  builds      近期构建：版本号、处理状态、挂到哪些测试群组
  next-build  按版本汇总已用过的构建号，并算出下一个

凭证读自 ${CREDENTIALS.pathname}（模板见 ${TEMPLATE.pathname}）。`

function fail(message) {
  console.error(message)
  process.exit(1)
}

/** Parses the KEY=VALUE credential file, ignoring blanks and comments. */
function loadCredentials() {
  let raw
  try {
    raw = readFileSync(CREDENTIALS, "utf8")
  } catch {
    fail(
      `读不到凭证文件：${CREDENTIALS.pathname}\n` +
      `复制模板填好即可：cp ${TEMPLATE.pathname} ${CREDENTIALS.pathname}`,
    )
  }

  const values = {}
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }

  const required = ["ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_KEY_PATH"]
  const missing = required.filter((key) => !values[key])
  if (missing.length > 0) {
    fail(`${CREDENTIALS.pathname} 缺少：${missing.join(", ")}\n格式见 ${TEMPLATE.pathname}`)
  }
  return values
}

/**
 * App Store Connect wants an ES256 JWT, refreshed well inside its 20-minute
 * ceiling. `ieee-p1363` is node's name for the raw R||S encoding JOSE uses --
 * the default DER output would be rejected.
 */
function authorizationToken(credentials) {
  const issuedAt = Math.floor(Date.now() / 1000)
  const signingInput = [
    Buffer.from(JSON.stringify({ alg: "ES256", kid: credentials.ASC_KEY_ID, typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({
      iss: credentials.ASC_ISSUER_ID,
      iat: issuedAt,
      exp: issuedAt + 600,
      aud: "appstoreconnect-v1",
    })).toString("base64url"),
  ].join(".")

  let privateKey
  try {
    privateKey = readFileSync(credentials.ASC_KEY_PATH)
  } catch {
    fail(`读不到 .p8 私钥：${credentials.ASC_KEY_PATH}\n（.p8 只能在生成密钥时下载一次，丢了就得吊销重建）`)
  }

  const signature = sign("sha256", Buffer.from(signingInput), { key: privateKey, dsaEncoding: "ieee-p1363" })
  return `${signingInput}.${signature.toString("base64url")}`
}

async function api(path, token) {
  const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    // Apple puts the useful sentence in errors[].detail, not in the status text.
    const detail = (body.errors ?? []).map((e) => e.detail ?? e.title).join("; ")
    fail(`GET ${path} -> HTTP ${response.status}${detail ? `: ${detail}` : ""}`)
  }
  return body
}

/** Follows `links.next` so a build-number answer can never be silently short. */
async function apiAll(path, token, maxPages = 10) {
  const data = []
  const included = []
  let next = path
  for (let page = 0; next && page < maxPages; page += 1) {
    const body = await api(next, token)
    data.push(...(body.data ?? []))
    included.push(...(body.included ?? []))
    next = body.links?.next?.replace("https://api.appstoreconnect.apple.com", "") ?? null
  }
  return { data, included }
}

const COMMANDS = ["app", "builds", "next-build"]
const command = process.argv[2]

// Usage has to work when the credentials do not -- that is exactly when someone
// runs it to find out what the commands are.
if (!command || command === "-h" || command === "--help") {
  console.log(usage)
  process.exit(0)
}
if (!COMMANDS.includes(command)) {
  console.error(`未知命令：${command}\n`)
  console.log(usage)
  process.exit(1)
}

const credentials = loadCredentials()
const token = authorizationToken(credentials)

switch (command) {
  case "app": {
    const body = await api(`/v1/apps?limit=50`, token)
    if (body.data.length === 0) fail("这个账号下没有可见的 app。")
    for (const app of body.data) {
      console.log(`${app.id}  ${app.attributes.name}  (${app.attributes.bundleId})`)
    }
    break
  }

  case "builds": {
    const body = await api(
      `/v1/builds?filter[app]=${APP_ID}&limit=10&sort=-uploadedDate&include=betaGroups`,
      token,
    )
    const groupNames = new Map(
      (body.included ?? []).filter((i) => i.type === "betaGroups").map((g) => [g.id, g.attributes.name]),
    )
    if (body.data.length === 0) {
      console.log("还没有任何构建。")
      break
    }
    for (const build of body.data) {
      const a = build.attributes
      const groups = (build.relationships?.betaGroups?.data ?? [])
        .map((ref) => groupNames.get(ref.id) ?? ref.id)
      // Apple reports times in US Pacific; say so rather than let it confuse.
      console.log(
        `build ${String(a.version).padEnd(4)} ${a.processingState.padEnd(9)}` +
        ` 上传 ${a.uploadedDate?.slice(0, 16).replace("T", " ")} PT` +
        `${a.expired ? "  [已过期]" : ""}` +
        `  群组=[${groups.join(", ") || "无"}]`,
      )
    }
    break
  }

  case "next-build": {
    const builds = await apiAll(
      `/v1/builds?filter[app]=${APP_ID}&limit=200&include=preReleaseVersion`,
      token,
    )
    const versionNames = new Map(
      builds.included.filter((i) => i.type === "preReleaseVersions")
        .map((v) => [v.id, v.attributes.version]),
    )

    const used = new Map()
    for (const build of builds.data) {
      const version = versionNames.get(build.relationships?.preReleaseVersion?.data?.id) ?? "(未知版本)"
      if (!used.has(version)) used.set(version, new Set())
      used.get(version).add(Number(build.attributes.version))
    }
    if (used.size === 0) {
      console.log("App Store Connect 上还没有构建，下一个号从 1 开始。")
      break
    }

    for (const [version, numbers] of [...used].sort()) {
      const sorted = [...numbers].sort((a, b) => a - b)
      console.log(`版本 ${version}：已用 ${sorted.join(", ")}  →  下一个 ${sorted.at(-1) + 1}`)
    }
    // release-ios.sh keeps its own local counter and self-heals on a collision,
    // so this is the tiebreaker when that counter and App Store Connect disagree.
    console.log("\n注：release-ios.sh 用的是本地计数器；两边不一致时以这边的最大值为准。")
    break
  }
}
