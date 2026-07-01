import { Test } from "@nestjs/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AgentPersonasModule } from "./agent-personas.module"

const env = {
  DATABASE_URL: "postgresql://synapse:synapse@localhost:5433/synapse",
  ADMIN_EMAIL: "admin@synapse.local",
  ADMIN_PASSWORD: "local-admin-password",
  ADMIN_JWT_SECRET: "admin-jwt-secret-for-local-tests-32",
  USER_ACCESS_JWT_SECRET: "user-jwt-secret-for-local-tests-32",
}

describe("AgentPersonasModule", () => {
  const previousEnv = { ...process.env }

  beforeEach(() => {
    Object.assign(process.env, env)
  })

  afterEach(() => {
    process.env = { ...previousEnv }
  })

  it("resolves auth guard dependencies for protected routes", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AgentPersonasModule],
    }).compile()

    await moduleRef.close()
    expect(moduleRef).toBeDefined()
  })
})
