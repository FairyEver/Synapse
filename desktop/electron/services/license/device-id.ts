import { createHash } from "node:crypto"
import { execSync } from "node:child_process"
import os from "node:os"
import type { DeviceMetadata } from "./types"

export function createDeviceId(): string {
  const raw = getMachineId()
  return createHash("sha256").update(`synapse:${raw}`, "utf8").digest("hex")
}

function getMachineId(): string {
  try {
    switch (process.platform) {
      case "darwin":
        return execSync(
          "ioreg -rd1 -c IOPlatformExpertDevice | awk '/IOPlatformUUID/{print $3}'",
          { encoding: "utf8", timeout: 5000 },
        ).trim().replace(/"/g, "")
      case "win32":
        return execSync(
          "reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid",
          { encoding: "utf8", timeout: 5000 },
        ).match(/REG_SZ\s+(.+)/)?.[1]?.trim() ?? os.hostname()
      default:
        return execSync("cat /etc/machine-id", { encoding: "utf8", timeout: 5000 }).trim()
    }
  } catch {
    return os.hostname() + os.cpus()[0]?.model + os.totalmem()
  }
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
