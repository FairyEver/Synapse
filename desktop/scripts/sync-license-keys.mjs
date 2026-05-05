import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const PRODUCTION_URL = "https://synapse.d2.pub/v1/license/config"
const PINNED_KEYS_PATH = path.resolve("electron/services/license/pinned-keys.ts")

async function main() {
  console.log(">>> 同步生产环境公钥...")

  const response = await fetch(PRODUCTION_URL, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status} ${response.statusText}`)
  }

  const config = await response.json()
  const { keyId, publicKey } = config

  if (!keyId || !publicKey) {
    throw new Error("服务器返回的配置缺少 keyId 或 publicKey")
  }

  const normalizedKey = normalizePublicKey(publicKey)
  console.log(`  keyId: ${keyId}`)
  console.log(`  publicKey: ${normalizedKey.split("\n")[1]}...`)

  const source = readFileSync(PINNED_KEYS_PATH, "utf8")

  if (source.includes(`keyId: "${keyId}"`)) {
    const keyLineMatch = source.match(
      new RegExp(`keyId: "${keyId}"[\\s\\S]*?publicKey: \\[([\\s\\S]*?)\\]\\.join`)
    )
    if (keyLineMatch) {
      const existingBase64 = keyLineMatch[1].match(/"([A-Za-z0-9+/=]+)"/)?.[1]
      const newBase64 = normalizedKey.split("\n")[1]
      if (existingBase64 && existingBase64 !== newBase64) {
        throw new Error(
          `keyId "${keyId}" 已存在但公钥不一致！\n` +
          `  已有: ${existingBase64}\n` +
          `  服务器: ${newBase64}\n` +
          `请确认服务器配置是否正确。`
        )
      }
    }
    console.log(`  keyId "${keyId}" 已存在且一致，跳过。`)
    return
  }

  const newEntry = [
    `  {`,
    `    keyId: "${keyId}",`,
    `    publicKey: [`,
    `      "-----BEGIN PUBLIC KEY-----",`,
    `      "${normalizedKey.split("\n")[1]}",`,
    `      "-----END PUBLIC KEY-----",`,
    `    ].join("\\n"),`,
    `  },`,
  ].join("\n")

  const updated = source.replace(
    /const PINNED_KEYS: readonly PinnedKey\[\] = \[/,
    `const PINNED_KEYS: readonly PinnedKey[] = [\n${newEntry}`
  )

  writeFileSync(PINNED_KEYS_PATH, updated, "utf8")
  console.log(`  已追加 keyId "${keyId}" 到 pinned-keys.ts`)
}

function normalizePublicKey(raw) {
  const cleaned = raw
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "")
  return `-----BEGIN PUBLIC KEY-----\n${cleaned}\n-----END PUBLIC KEY-----`
}

main().catch((error) => {
  console.error("❌ 公钥同步失败:", error.message)
  process.exit(1)
})
