import { BadRequestException, Injectable } from "@nestjs/common"
import { lookup as dnsLookup } from "node:dns/promises"
import { isIP } from "node:net"

export const MAX_REMOTE_IMAGE_BYTES = 100 * 1024 * 1024

const MAX_REDIRECT_COUNT = 5
const REMOTE_IMAGE_TIMEOUT_MS = 15_000
const GENERIC_FETCH_ERROR = "图片无法转存。"
const UNSUPPORTED_FORMAT_ERROR = "格式不支持。"
const IMAGE_TOO_LARGE_ERROR = "图片过大。"
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const IPV6_BLOCKED_PREFIXES: readonly { readonly prefix: readonly number[]; readonly bits: number }[] = [
  { prefix: new Array(16).fill(0), bits: 128 },
  { prefix: [...new Array(15).fill(0), 1], bits: 128 },
  { prefix: new Array(12).fill(0), bits: 96 },
  { prefix: [0x00, 0x64, 0xff, 0x9b], bits: 96 },
  { prefix: [0x00, 0x64, 0xff, 0x9b, 0x00, 0x01], bits: 48 },
  { prefix: [0x01, 0x00], bits: 64 },
  { prefix: [0x20, 0x01, 0x00], bits: 23 },
  { prefix: [0x20, 0x01, 0x0d, 0xb8], bits: 32 },
  { prefix: [0x20, 0x02], bits: 16 },
  { prefix: [0xfc], bits: 7 },
  { prefix: [0xfe, 0x80], bits: 10 },
  { prefix: [0xff], bits: 8 },
]

interface DriveLookupAddress {
  readonly address: string
  readonly family?: number
}

type DriveLookup = (hostname: string) => Promise<readonly DriveLookupAddress[]>

export interface DriveFetchedRemoteImage {
  readonly body: Buffer
  readonly mimeType: string
  readonly size: bigint
}

@Injectable()
export class DriveRemoteImageFetcher {
  constructor(
    private readonly fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
    private readonly lookupImplementation: DriveLookup = lookupAll,
  ) {}

  async fetchImage(src: string): Promise<DriveFetchedRemoteImage> {
    let url = parseRemoteImageUrl(src)

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECT_COUNT; redirectCount += 1) {
      await this.assertSafeUrl(url)

      const response = await this.fetchSafe(url)

      if (isRedirectResponse(response)) {
        if (redirectCount >= MAX_REDIRECT_COUNT) throw new BadRequestException(GENERIC_FETCH_ERROR)

        const location = response.headers.get("location")
        if (!location) throw new BadRequestException(GENERIC_FETCH_ERROR)
        url = parseRemoteImageUrl(location, url)
        continue
      }

      if (!response.ok) throw new BadRequestException(GENERIC_FETCH_ERROR)
      return readImageResponse(response)
    }

    throw new BadRequestException(GENERIC_FETCH_ERROR)
  }

  private async assertSafeUrl(url: URL): Promise<void> {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new BadRequestException(GENERIC_FETCH_ERROR)

    const hostname = normalizeHostname(url.hostname)
    if (!hostname || isLocalhostName(hostname)) throw new BadRequestException(GENERIC_FETCH_ERROR)

    const literalIpVersion = isIP(hostname)
    if (literalIpVersion !== 0) {
      if (isBlockedIpAddress(hostname)) throw new BadRequestException(GENERIC_FETCH_ERROR)
      return
    }

    const addresses = await this.lookupSafeAddresses(hostname)
    if (addresses.length === 0) throw new BadRequestException(GENERIC_FETCH_ERROR)
    if (addresses.some((address) => isBlockedIpAddress(address.address))) {
      throw new BadRequestException(GENERIC_FETCH_ERROR)
    }
  }

  private async lookupSafeAddresses(hostname: string): Promise<readonly DriveLookupAddress[]> {
    try {
      return await this.lookupImplementation(hostname)
    } catch {
      throw new BadRequestException(GENERIC_FETCH_ERROR)
    }
  }

  private async fetchSafe(url: URL): Promise<Response> {
    try {
      return await this.fetchImplementation(url.href, {
        redirect: "manual",
        signal: AbortSignal.timeout(REMOTE_IMAGE_TIMEOUT_MS),
      })
    } catch {
      throw new BadRequestException(GENERIC_FETCH_ERROR)
    }
  }
}

async function lookupAll(hostname: string): Promise<readonly DriveLookupAddress[]> {
  return dnsLookup(hostname, { all: true })
}

function parseRemoteImageUrl(src: string, base?: URL): URL {
  try {
    const url = new URL(src, base)
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new BadRequestException(GENERIC_FETCH_ERROR)
    return url
  } catch (error) {
    if (error instanceof BadRequestException) throw error
    throw new BadRequestException(GENERIC_FETCH_ERROR)
  }
}

function isRedirectResponse(response: Response): boolean {
  return response.status >= 300 && response.status < 400
}

async function readImageResponse(response: Response): Promise<DriveFetchedRemoteImage> {
  const contentLength = parseContentLength(response.headers.get("content-length"))
  if (contentLength !== null && contentLength > BigInt(MAX_REMOTE_IMAGE_BYTES)) {
    throw new BadRequestException(IMAGE_TOO_LARGE_ERROR)
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
  if (contentType.split(";")[0]?.trim() === "image/svg+xml") {
    throw new BadRequestException(UNSUPPORTED_FORMAT_ERROR)
  }

  const body = await readResponseBody(response)
  if (body.byteLength > MAX_REMOTE_IMAGE_BYTES) throw new BadRequestException(IMAGE_TOO_LARGE_ERROR)

  const mimeType = detectRemoteImageMimeType(body)
  if (!mimeType) throw new BadRequestException(UNSUPPORTED_FORMAT_ERROR)

  return {
    body,
    mimeType,
    size: BigInt(body.byteLength),
  }
}

async function readResponseBody(response: Response): Promise<Buffer> {
  try {
    return Buffer.from(await response.arrayBuffer())
  } catch {
    throw new BadRequestException(GENERIC_FETCH_ERROR)
  }
}

function parseContentLength(value: string | null): bigint | null {
  if (!value) return null

  const trimmedValue = value.trim()
  if (!/^\d+$/u.test(trimmedValue)) return null
  return BigInt(trimmedValue)
}

function detectRemoteImageMimeType(bytes: Buffer): string | null {
  if (bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return "image/png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"

  const gifHeader = bytes.subarray(0, 6).toString("ascii")
  if (gifHeader === "GIF87a" || gifHeader === "GIF89a") return "image/gif"

  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp"
  }

  if (bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    const brands = bytes.subarray(8, 32).toString("ascii")
    if (brands.includes("avif") || brands.includes("avis")) return "image/avif"
  }

  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return "image/x-icon"
  return null
}

function normalizeHostname(hostname: string): string {
  let normalized = hostname.trim().toLowerCase()
  if (normalized.startsWith("[") && normalized.endsWith("]")) normalized = normalized.slice(1, -1)
  if (normalized.endsWith(".")) normalized = normalized.slice(0, -1)
  return normalized
}

function isLocalhostName(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost")
}

function isBlockedIpAddress(address: string): boolean {
  const normalizedAddress = normalizeIpLiteral(address)
  const ipVersion = isIP(normalizedAddress)
  if (ipVersion === 4) return isBlockedIpv4Address(normalizedAddress)
  if (ipVersion === 6) return isBlockedIpv6Address(normalizedAddress)
  return true
}

function normalizeIpLiteral(address: string): string {
  let normalized = address.trim().toLowerCase()
  if (normalized.startsWith("[") && normalized.endsWith("]")) normalized = normalized.slice(1, -1)

  const zoneIndex = normalized.indexOf("%")
  if (zoneIndex >= 0) normalized = normalized.slice(0, zoneIndex)
  return normalized
}

function isBlockedIpv4Address(address: string): boolean {
  const octets = parseIpv4Octets(address)
  if (!octets) return true

  const [first, second, third] = octets
  if (first === undefined || second === undefined || third === undefined) return true

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  )
}

function parseIpv4Octets(address: string): readonly number[] | null {
  const parts = address.split(".")
  if (parts.length !== 4) return null

  const octets = parts.map((part) => {
    if (!/^\d+$/u.test(part)) return Number.NaN
    const value = Number(part)
    return value >= 0 && value <= 255 ? value : Number.NaN
  })

  return octets.some((octet) => Number.isNaN(octet)) ? null : octets
}

function isBlockedIpv6Address(address: string): boolean {
  const bytes = parseIpv6Bytes(address)
  if (!bytes) return true

  const mappedIpv4 = extractMappedIpv4Address(bytes)
  if (mappedIpv4) return isBlockedIpv4Address(mappedIpv4)

  return IPV6_BLOCKED_PREFIXES.some((range) => matchesIpv6Prefix(bytes, range.prefix, range.bits))
}

function extractMappedIpv4Address(bytes: readonly number[]): string | null {
  if (!matchesIpv6Prefix(bytes, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff], 96)) {
    return null
  }

  return bytes.slice(12, 16).join(".")
}

function parseIpv6Bytes(address: string): readonly number[] | null {
  const expandedAddress = expandIpv6Address(address)
  if (!expandedAddress) return null

  const bytes: number[] = []
  for (const group of expandedAddress) {
    bytes.push((group >> 8) & 0xff, group & 0xff)
  }
  return bytes
}

function expandIpv6Address(address: string): readonly number[] | null {
  const normalizedAddress = normalizeIpv4EmbeddedIpv6(address)
  if (!normalizedAddress) return null

  const doubleColonParts = normalizedAddress.split("::")
  if (doubleColonParts.length > 2) return null

  const head = parseIpv6Groups(doubleColonParts[0] ?? "")
  const tail = parseIpv6Groups(doubleColonParts[1] ?? "")
  if (!head || !tail) return null

  if (doubleColonParts.length === 1) return head.length === 8 ? head : null

  const zeroCount = 8 - head.length - tail.length
  if (zeroCount < 1) return null
  return [...head, ...new Array(zeroCount).fill(0), ...tail]
}

function normalizeIpv4EmbeddedIpv6(address: string): string | null {
  if (!address.includes(".")) return address

  const lastColonIndex = address.lastIndexOf(":")
  if (lastColonIndex < 0) return null

  const ipv4Octets = parseIpv4Octets(address.slice(lastColonIndex + 1))
  if (!ipv4Octets) return null

  const firstGroup = ((ipv4Octets[0] ?? 0) << 8) | (ipv4Octets[1] ?? 0)
  const secondGroup = ((ipv4Octets[2] ?? 0) << 8) | (ipv4Octets[3] ?? 0)
  return `${address.slice(0, lastColonIndex)}:${firstGroup.toString(16)}:${secondGroup.toString(16)}`
}

function parseIpv6Groups(value: string): readonly number[] | null {
  if (!value) return []

  const groups = value.split(":")
  const parsedGroups = groups.map((group) => {
    if (!/^[0-9a-f]{1,4}$/iu.test(group)) return Number.NaN
    return Number.parseInt(group, 16)
  })
  return parsedGroups.some((group) => Number.isNaN(group)) ? null : parsedGroups
}

function matchesIpv6Prefix(bytes: readonly number[], prefix: readonly number[], bits: number): boolean {
  for (let bitIndex = 0; bitIndex < bits; bitIndex += 1) {
    const byteIndex = Math.floor(bitIndex / 8)
    const bitMask = 1 << (7 - (bitIndex % 8))
    const actualByte = bytes[byteIndex] ?? 0
    const expectedByte = prefix[byteIndex] ?? 0
    if ((actualByte & bitMask) !== (expectedByte & bitMask)) return false
  }
  return true
}
