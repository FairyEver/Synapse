import { createHash, randomUUID } from "node:crypto"
import os from "node:os"
import type { DeviceMetadata } from "./types"

export function createDeviceId(): string {
  return randomUUID()
}

export function hashDeviceId(deviceId: string): string {
  return createHash("sha256").update(deviceId.trim(), "utf8").digest("hex")
}

export function createDeviceMetadata(deviceId: string, appVersion: string): DeviceMetadata {
  return {
    deviceId,
    name: os.hostname() || "Synapse Desktop",
    platform: process.platform,
    appVersion,
  }
}
