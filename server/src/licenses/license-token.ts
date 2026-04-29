import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto"
import type { LicenseLeasePayload } from "./license.types"

interface SignedLeaseEnvelope {
  readonly payload: LicenseLeasePayload
  readonly signature: string
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}

function decode<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T
}

export function signLicenseLease(payload: LicenseLeasePayload, privateKeyPem: string): string {
  const encodedPayload = encode(payload)
  const signature = sign(null, Buffer.from(encodedPayload), createPrivateKey(privateKeyPem))
  const envelope: SignedLeaseEnvelope = {
    payload,
    signature: signature.toString("base64url"),
  }
  return encode(envelope)
}

export function verifyLicenseLease(token: string, publicKeyPem: string): LicenseLeasePayload {
  try {
    const envelope = decode<SignedLeaseEnvelope>(token)
    const encodedPayload = encode(envelope.payload)
    const valid = verify(
      null,
      Buffer.from(encodedPayload),
      createPublicKey(publicKeyPem),
      Buffer.from(envelope.signature, "base64url"),
    )

    if (!valid) {
      throw new Error("授权签名无效。")
    }

    return envelope.payload
  } catch (error) {
    if (error instanceof Error && error.message === "授权签名无效。") {
      throw error
    }
    throw new Error("授权签名无效。")
  }
}
