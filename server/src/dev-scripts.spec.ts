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
      "docker compose --env-file server/.env.local -f server/compose.yml -f server/compose.dev.yml up -d --build postgres pdf-renderer",
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

    // 入口是一层薄封装：停止逻辑在 quit-server.mjs 里，它先停 dev:server 的进程，
    // 再 down 掉本地 compose 栈。断言委托关系而不只是字符串，避免入口改名后
    // 测试仍然通过、实际却不再停任何东西。
    expect(workspacePackage.scripts?.["quit:server"]).toBe("node scripts/dev/quit-server.mjs")

    const quitServer = readFileSync(join(process.cwd(), "../scripts/dev/quit-server.mjs"), "utf8")
    expect(quitServer).toContain("quit-processes.mjs")
    expect(quitServer).toContain('"dev:server"')
    expect(quitServer).toContain("docker")
    expect(quitServer).toContain("down")

    expect(workspacePackage.scripts?.["quit:docker"]).toBeUndefined()
  })
})
