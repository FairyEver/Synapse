import https from "node:https"
import type { IncomingMessage } from "node:http"
import { isIP } from "node:net"
import { MailError } from "../shared/types"

// Only the standard IPv4 Fake-IP pool is eligible for independent resolution.
// It is never itself a permitted image destination, including literal IP URLs.
export function isImageFakeIp(address: string): boolean {
  if (isIP(address) !== 4) return false
  const [a, b] = address.split(".").map(Number)
  return a === 198 && (b === 18 || b === 19)
}

// Bootstrap with a fixed public IP so the resolver cannot itself resolve to Fake-IP.
// TLS still verifies dns.alidns.com; no redirects, cookies or credentials are used.
const DNS_ORIGIN = "https://dns.alidns.com"
const DNS_ADDRESS = "223.5.5.5"
const MAX_DNS_BYTES = 64 * 1024
const resolutionFailed = () => new MailError("IMAGE_FAILED", "无法解析图片的真实地址，请稍后重试")

async function queryImageDns(host: string, type: "A" | "AAAA", signal: AbortSignal) {
  signal.throwIfAborted()
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = https.request({
      hostname: DNS_ADDRESS, servername: "dns.alidns.com", port: 443,
      path: `/resolve?${new URLSearchParams({ name: host, type })}`, method: "GET",
      headers: { Host: "dns.alidns.com", Accept: "application/dns-json" },
      agent: false, signal, timeout: 10_000,
    }, resolve)
    request.once("error", () => reject(resolutionFailed()))
    request.once("timeout", () => request.destroy(resolutionFailed()))
    request.end()
  })
  try {
    if (response.statusCode !== 200 || Number(response.headers["content-length"] ?? 0) > MAX_DNS_BYTES) throw resolutionFailed()
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of response) {
      signal.throwIfAborted()
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > MAX_DNS_BYTES) throw resolutionFailed()
      chunks.push(bytes)
    }
    const payload: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (!payload || typeof payload !== "object" || !("Status" in payload) || payload.Status !== 0 || ("TC" in payload && payload.TC === true)) throw resolutionFailed()
    const answers = "Answer" in payload ? payload.Answer : []
    if (!Array.isArray(answers)) throw resolutionFailed()
    const addresses: { address: string; family: number }[] = []
    for (const answer of answers) {
      if (!answer || typeof answer !== "object") throw resolutionFailed()
      if (answer.type !== 1 && answer.type !== 28) continue
      const family = answer.type === 1 ? 4 : 6
      if (typeof answer.data !== "string" || isIP(answer.data) !== family) throw resolutionFailed()
      addresses.push({ address: answer.data, family })
    }
    return addresses
  } finally { response.destroy() }
}

export async function resolveImageFakeIp(host: string, signal: AbortSignal, authorize: (origin: string) => Promise<void>) {
  await authorize(DNS_ORIGIN)
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)])
  // Both families must finish validation before the caller connects to any address.
  const ipv4 = await queryImageDns(host, "A", boundedSignal)
  const ipv6 = await queryImageDns(host, "AAAA", boundedSignal)
  return [...ipv4, ...ipv6]
}
