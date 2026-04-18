import { randomUUID } from "node:crypto"
import { app } from "electron"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { SynapseIdentityState, SynapseUserIdentity } from "../../src/types/identity"
import { createMainLogger } from "./log-store"

const USER_IDENTITY_FILE_NAME = "user-identity.json"
const USER_IDENTITY_SCHEMA_VERSION = 1 as const
const logger = createMainLogger("service.user-identity")

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function generateUserId(): string {
  return randomUUID().replace(/-/g, "")
}

function normalizeUserId(input: string): string | null {
  const cleaned = input.trim().toLowerCase().replace(/-/g, "")

  if (!/^[0-9a-f]{32}$/.test(cleaned)) {
    return null
  }

  return cleaned
}

function createIdentity(displayName = ""): SynapseUserIdentity {
  return {
    schemaVersion: USER_IDENTITY_SCHEMA_VERSION,
    userId: generateUserId(),
    displayName: displayName.trim(),
    generatedAt: new Date().toISOString(),
  }
}

function normalizeIdentity(rawValue: unknown): SynapseUserIdentity | null {
  if (!isRecord(rawValue)) {
    return null
  }

  const userId = typeof rawValue.userId === "string" ? normalizeUserId(rawValue.userId) : null

  if (!userId) {
    return null
  }

  const generatedAt =
    typeof rawValue.generatedAt === "string" && rawValue.generatedAt.trim().length > 0
      ? rawValue.generatedAt
      : new Date().toISOString()

  return {
    schemaVersion: USER_IDENTITY_SCHEMA_VERSION,
    userId,
    displayName: typeof rawValue.displayName === "string" ? rawValue.displayName.trim() : "",
    generatedAt,
  }
}

class UserIdentityService {
  getFilePath(): string {
    return path.join(app.getPath("userData"), USER_IDENTITY_FILE_NAME)
  }

  async loadState(): Promise<SynapseIdentityState> {
    const filePath = this.getFilePath()

    await mkdir(path.dirname(filePath), { recursive: true })

    try {
      const fileContent = await readFile(filePath, "utf8")
      const parsedValue = JSON.parse(fileContent) as unknown
      const identity = normalizeIdentity(parsedValue)

      if (!identity) {
        logger.warn("User identity file is invalid.", { filePath })
        const invalidUserId =
          isRecord(parsedValue) && typeof parsedValue.userId === "string"
            ? parsedValue.userId
            : null

        return {
          status: "needs-recovery",
          invalidUserId,
        }
      }

      await this.persist(identity)

      return {
        status: identity.displayName ? "ready" : "needs-onboarding",
        identity,
      }
    } catch (error) {
      if (isFileNotFoundError(error)) {
        const identity = createIdentity()
        await this.persist(identity)

        logger.info("Generated new user identity for first launch.", {
          userId: identity.userId,
        })

        return {
          status: "needs-onboarding",
          identity,
        }
      }

      if (error instanceof SyntaxError) {
        logger.warn("User identity file contains invalid JSON.", { filePath })
        return {
          status: "needs-recovery",
          invalidUserId: null,
        }
      }

      throw error
    }
  }

  async requireReadyIdentity(): Promise<SynapseUserIdentity> {
    const state = await this.loadState()

    if (state.status === "needs-recovery") {
      throw new Error("身份 ID 无法读取，请先在设置页恢复身份。")
    }

    if (!state.identity.displayName) {
      throw new Error("请先完成身份设置并填写显示名称。")
    }

    return state.identity
  }

  async updateDisplayName(displayName: string): Promise<SynapseIdentityState> {
    const state = await this.loadState()

    if (state.status === "needs-recovery") {
      throw new Error("身份 ID 无法读取，请先恢复身份。")
    }

    const nextIdentity: SynapseUserIdentity = {
      ...state.identity,
      displayName: displayName.trim(),
    }

    await this.persist(nextIdentity)

    return {
      status: nextIdentity.displayName ? "ready" : "needs-onboarding",
      identity: nextIdentity,
    }
  }

  async replaceUserId(rawUserId: string): Promise<SynapseIdentityState> {
    const nextUserId = normalizeUserId(rawUserId)

    if (!nextUserId) {
      throw new Error("ID 格式不对，应为 32 位十六进制字符。")
    }

    const currentState = await this.loadState()
    const nextIdentity: SynapseUserIdentity = {
      schemaVersion: USER_IDENTITY_SCHEMA_VERSION,
      userId: nextUserId,
      displayName:
        currentState.status === "needs-recovery" ? "" : currentState.identity.displayName.trim(),
      generatedAt: new Date().toISOString(),
    }

    await this.persist(nextIdentity)

    return {
      status: nextIdentity.displayName ? "ready" : "needs-onboarding",
      identity: nextIdentity,
    }
  }

  async generateNewIdentity(): Promise<SynapseIdentityState> {
    const currentState = await this.loadState()
    const nextIdentity = createIdentity(
      currentState.status === "needs-recovery" ? "" : currentState.identity.displayName,
    )

    await this.persist(nextIdentity)

    return {
      status: nextIdentity.displayName ? "ready" : "needs-onboarding",
      identity: nextIdentity,
    }
  }

  private async persist(identity: SynapseUserIdentity): Promise<void> {
    const filePath = this.getFilePath()

    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, `${JSON.stringify(identity, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    })
  }
}

export {
  generateUserId,
  normalizeUserId,
  userIdentityService,
}

const userIdentityService = new UserIdentityService()
