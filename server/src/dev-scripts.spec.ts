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
    expect(scripts.dev).toContain("DOCUMENT_PUBLIC_URL=${DOCUMENT_PUBLIC_URL:-http://localhost:19773/document}")
    expect(scripts["dev:api"]).toContain("pnpm --filter @synapse/shared run build")
    expect(scripts["dev:api"]).toContain("nest start --watch")
    expect(scripts["dev:admin"]).toBeUndefined()
  })

  it("keeps one combined workspace dev command", () => {
    const workspacePackage = readPackageJson(join(process.cwd(), "../package.json"))

    expect(workspacePackage.scripts?.dev).toContain("pnpm run dev:server")
    expect(workspacePackage.scripts?.dev).toContain("pnpm run dev:desktop")
  })

  it("keeps one workspace server dev entrypoint for the backend stack", () => {
    const workspacePackage = readPackageJson(join(process.cwd(), "../package.json"))

    expect(workspacePackage.scripts?.["dev:server"]).toContain(
      "docker compose --env-file server/.env.local -f server/compose.yml up -d postgres",
    )
    expect(workspacePackage.scripts?.["dev:server"]).toContain(
      "--filter @synapse/server run dev",
    )
    expect(workspacePackage.scripts?.["dev:server"]).toContain(
      "node scripts/dev/wait-for-http.mjs http://127.0.0.1:${SYNAPSE_SERVER_API_PORT:-3001}/healthz",
    )
    expect(workspacePackage.scripts?.["dev:server"]).toContain(
      "--filter @synapse/dashboard run dev",
    )
    expect(workspacePackage.scripts?.["dev:dashboard"]).toBeUndefined()
    expect(workspacePackage.scripts?.["dev:server:full"]).toBeUndefined()
  })

  it("keeps one workspace server quit entrypoint for the backend stack", () => {
    const workspacePackage = readPackageJson(join(process.cwd(), "../package.json"))

    expect(workspacePackage.scripts?.["quit:server"]).toContain(
      "node scripts/dev/quit-processes.mjs dev:server",
    )
    expect(workspacePackage.scripts?.["quit:server"]).toContain(
      "docker compose --env-file server/.env.local -f server/compose.yml down",
    )
    expect(workspacePackage.scripts?.["quit:docker"]).toBeUndefined()
  })
})
