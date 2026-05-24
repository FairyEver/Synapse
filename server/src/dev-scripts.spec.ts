import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

interface PackageJson {
  readonly scripts?: Record<string, string>
}

function readPackageJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, "utf8")) as PackageJson
}

describe("server dev scripts", () => {
  it("runs only the api watch server", () => {
    const serverPackage = readPackageJson(join(process.cwd(), "package.json"))
    const scripts = serverPackage.scripts ?? {}

    expect(scripts.dev).toContain("dev:api")
    expect(scripts.dev).toContain("APP_PUBLIC_URL=${APP_PUBLIC_URL:-http://localhost:3000}")
    expect(scripts["dev:api"]).toBe("nest start --watch")
    expect(scripts["dev:admin"]).toBeUndefined()
  })

  it("does not expose a combined workspace dev command", () => {
    const workspacePackage = readPackageJson(join(process.cwd(), "../package.json"))

    expect(workspacePackage.scripts?.dev).toBeUndefined()
  })

  it("keeps the workspace server dev entrypoint on the backend stack script", () => {
    const workspacePackage = readPackageJson(join(process.cwd(), "../package.json"))

    expect(workspacePackage.scripts?.["dev:server"]).toContain(
      "docker compose --env-file server/.env -f server/compose.yml up -d postgres",
    )
    expect(workspacePackage.scripts?.["dev:server"]).toContain(
      "--filter @synapse/server run dev",
    )
    expect(workspacePackage.scripts?.["dev:dashboard"]).toBe(
      "pnpm --filter @synapse/dashboard run dev",
    )
  })
})
