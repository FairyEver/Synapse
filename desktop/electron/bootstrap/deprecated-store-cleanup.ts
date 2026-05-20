import { rm } from "node:fs/promises"
import path from "node:path"
import type { StructuredLogger } from "../runtime/service-registry"

type CleanupLogger = Pick<StructuredLogger, "info" | "warn">

const DEPRECATED_ENCRYPTED_STORE_FILES = [
  "core.license.bin",
]

export function getDeprecatedEncryptedStorePath(
  userDataPath: string,
  fileName: string,
): string {
  return path.join(userDataPath, "data-v1", fileName)
}

export async function clearDeprecatedStores(
  userDataPath: string,
  logger?: CleanupLogger,
): Promise<void> {
  for (const fileName of DEPRECATED_ENCRYPTED_STORE_FILES) {
    try {
      await rm(getDeprecatedEncryptedStorePath(userDataPath, fileName), { force: true })
      logger?.info("Deprecated encrypted store cleanup finished.", { fileName })
    } catch (error) {
      logger?.warn("Failed to clear deprecated encrypted store.", { error, fileName })
    }
  }
}
