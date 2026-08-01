import { Test } from "@nestjs/testing"
import { afterEach, describe, expect, it } from "vitest"
import { PrismaService } from "../prisma/prisma.service"
import { WebhookModule } from "./webhook.module"

const requiredEnv = {
  DATABASE_URL: "postgresql://synapse:synapse@localhost:5432/synapse",
  ADMIN_ACCESS_SECRET: "Qv2jY7mD9kL4sN8pR3tW6xZ1cF5hJ0uB7eG2iM9oK4A",
  USER_ACCESS_JWT_SECRET: "user-jwt-secret-with-enough-length-32chars",
}

const originalEnv = new Map<keyof typeof requiredEnv, string | undefined>()

describe("WebhookModule", () => {
  afterEach(() => {
    for (const key of Object.keys(requiredEnv) as Array<keyof typeof requiredEnv>) {
      const originalValue = originalEnv.get(key)
      if (originalValue === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = originalValue
      }
    }
    originalEnv.clear()
  })

  it("compiles dashboard webhook routes with their auth guard dependencies", async () => {
    setRequiredEnv()

    const moduleRef = await Test.createTestingModule({
      imports: [WebhookModule],
    })
      .overrideProvider(PrismaService)
      .useValue(createPrismaServiceStub())
      .compile()

    await moduleRef.close()
    expect(moduleRef).toBeDefined()
  })
})

function setRequiredEnv(): void {
  for (const [key, value] of Object.entries(requiredEnv) as Array<[keyof typeof requiredEnv, string]>) {
    originalEnv.set(key, process.env[key])
    process.env[key] = value
  }
}

function createPrismaServiceStub(): Partial<PrismaService> {
  return {
    $connect: async () => undefined,
    $disconnect: async () => undefined,
  }
}
