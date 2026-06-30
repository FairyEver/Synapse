import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"
import type { DriveAccessExpiresIn } from "@synapse/shared"
import { hashPassword, verifyPassword } from "../auth/password"

export type { DriveAccessExpiresIn } from "@synapse/shared"

export type DriveAccessCookieKind = "share" | "site"

export type DrivePasswordMaterial = {
  readonly passwordEnabled: boolean
  readonly password: string | null
  readonly passwordHash: string | null
  readonly passwordEncrypted: string | null
  readonly expiresAt: Date | null
}

type DriveAccessCookiePayload = {
  readonly version: 1
  readonly kind: DriveAccessCookieKind
  readonly publicId: string
  readonly expiresMs: number
  readonly passwordFingerprint: string | null
}

const drivePasswordAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
const drivePasswordLength = 8
const encryptedPasswordVersion = "v1"
const driveAccessCookieVersion = 1

export function generateDrivePassword(): string {
  const maxAllowedByte = 256 - (256 % drivePasswordAlphabet.length)
  let password = ""

  while (password.length < drivePasswordLength) {
    const bytes = randomBytes(drivePasswordLength)
    for (const byte of bytes) {
      if (byte >= maxAllowedByte) continue
      password += drivePasswordAlphabet[byte % drivePasswordAlphabet.length]
      if (password.length === drivePasswordLength) break
    }
  }

  return password
}

export function computeDriveAccessExpiresAt(expiresIn: DriveAccessExpiresIn, now = new Date()): Date | null {
  if (expiresIn === "forever") return null
  if (expiresIn === "1y") {
    const expiresAt = new Date(now.getTime())
    expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1)
    return expiresAt
  }

  const days = expiresIn === "3d" ? 3 : expiresIn === "7d" ? 7 : 30
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
}

export function encryptDrivePassword(password: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", deriveDriveAccessKey(secret), iv)
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    encryptedPasswordVersion,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".")
}

export function decryptDrivePassword(value: string, secret: string): string | null {
  try {
    const parts = value.split(".")
    if (parts.length !== 4) return null

    const [version, ivValue, tagValue, ciphertextValue] = parts
    if (version !== encryptedPasswordVersion || !ivValue || !tagValue || !ciphertextValue) return null

    const iv = Buffer.from(ivValue, "base64url")
    const tag = Buffer.from(tagValue, "base64url")
    const ciphertext = Buffer.from(ciphertextValue, "base64url")
    const decipher = createDecipheriv("aes-256-gcm", deriveDriveAccessKey(secret), iv)
    decipher.setAuthTag(tag)

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
  } catch {
    return null
  }
}

export async function createDrivePasswordMaterial(
  input: {
    readonly passwordEnabled: boolean
    readonly expiresIn: DriveAccessExpiresIn
  },
  secret: string,
  now = new Date(),
): Promise<DrivePasswordMaterial> {
  const expiresAt = computeDriveAccessExpiresAt(input.expiresIn, now)
  if (!input.passwordEnabled) {
    return {
      passwordEnabled: false,
      password: null,
      passwordHash: null,
      passwordEncrypted: null,
      expiresAt,
    }
  }

  const password = generateDrivePassword()
  return {
    passwordEnabled: true,
    password,
    passwordHash: await hashPassword(password),
    passwordEncrypted: encryptDrivePassword(password, secret),
    expiresAt,
  }
}

export function buildDriveAccessCookie(input: {
  readonly kind: DriveAccessCookieKind
  readonly publicId: string
  readonly expiresAt: Date | null
  readonly passwordHash: string | null | undefined
  readonly secret: string
}): string {
  const payload: DriveAccessCookiePayload = {
    version: driveAccessCookieVersion,
    kind: input.kind,
    publicId: input.publicId,
    expiresMs: input.expiresAt?.getTime() ?? 0,
    passwordFingerprint: fingerprintDrivePasswordHash(input.passwordHash),
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  const signature = signDriveAccessCookiePayload(encodedPayload, input.secret)

  return `${encodedPayload}.${signature}`
}

export function verifyDriveAccessCookie(
  value: string | null | undefined,
  input: {
    readonly kind: DriveAccessCookieKind
    readonly publicId: string
    readonly now: Date
    readonly passwordHash: string | null | undefined
    readonly resourceExpiresAt: Date | null
    readonly secret: string
  },
): boolean {
  if (!value) return false

  const [encodedPayload, signature, extra] = value.split(".")
  if (!encodedPayload || !signature || extra !== undefined) return false

  const expectedSignature = signDriveAccessCookiePayload(encodedPayload, input.secret)
  if (!safeEqual(signature, expectedSignature)) return false

  const payload = parseDriveAccessCookiePayload(encodedPayload)
  if (!payload) return false
  if (payload.kind !== input.kind || payload.publicId !== input.publicId) return false
  if (payload.passwordFingerprint !== fingerprintDrivePasswordHash(input.passwordHash)) return false

  const expiresMs = earliestExpiringMs(payload.expiresMs, input.resourceExpiresAt?.getTime() ?? 0)
  if (expiresMs === 0) return true

  return input.now.getTime() < expiresMs
}

export async function verifyDrivePasswordInput(password: string | null | undefined, hash: string | null | undefined): Promise<boolean> {
  if (!password || !hash) return false
  return verifyPassword(password, hash)
}

function deriveDriveAccessKey(secret: string): Buffer {
  return createHash("sha256").update(`synapse-drive-access:${secret}`, "utf8").digest()
}

function signDriveAccessCookiePayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", deriveDriveAccessKey(secret)).update(encodedPayload, "utf8").digest("base64url")
}

function fingerprintDrivePasswordHash(passwordHash: string | null | undefined): string | null {
  if (passwordHash === null || passwordHash === undefined) return null

  return createHash("sha256").update(`synapse-drive-access-cookie:${passwordHash}`, "utf8").digest("base64url")
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8")
  const rightBuffer = Buffer.from(right, "utf8")
  if (leftBuffer.length !== rightBuffer.length) return false

  return timingSafeEqual(leftBuffer, rightBuffer)
}

function parseDriveAccessCookiePayload(encodedPayload: string): DriveAccessCookiePayload | null {
  try {
    const value = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<DriveAccessCookiePayload>
    if (value.version !== driveAccessCookieVersion) return null
    if (!isDriveAccessCookieKind(value.kind)) return null
    if (typeof value.publicId !== "string" || !value.publicId) return null
    if (typeof value.expiresMs !== "number" || !Number.isSafeInteger(value.expiresMs) || value.expiresMs < 0) return null
    if (value.passwordFingerprint !== null && typeof value.passwordFingerprint !== "string") return null

    return {
      version: driveAccessCookieVersion,
      kind: value.kind,
      publicId: value.publicId,
      expiresMs: value.expiresMs,
      passwordFingerprint: value.passwordFingerprint,
    }
  } catch {
    return null
  }
}

function isDriveAccessCookieKind(value: unknown): value is DriveAccessCookieKind {
  return value === "share" || value === "site"
}

function earliestExpiringMs(left: number, right: number): number {
  if (left === 0) return right
  if (right === 0) return left

  return Math.min(left, right)
}
