import { rm } from "node:fs/promises"
import path from "node:path"
import type { StructuredLogger } from "../runtime/service-registry"

type CleanupLogger = Pick<StructuredLogger, "info" | "warn">

export function getDeprecatedLicenseStorePath(userDataPath: string): string {
  return path.join(userDataPath, "data-v1", "core.license.bin")
}

export async function clearDeprecatedLicenseStore(
  userDataPath: string,
  logger?: CleanupLogger,
): Promise<void> {
  try {
    await rm(getDeprecatedLicenseStorePath(userDataPath), { force: true })
    logger?.info("Deprecated license store cleanup finished.")
  } catch (error) {
    logger?.warn("Failed to clear deprecated license store.", { error })
  }
}
