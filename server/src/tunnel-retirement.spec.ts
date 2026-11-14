import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { loadEnv } from "./config/env"

const repositoryRoot = join(process.cwd(), "..")
const retirementMigration = "server/prisma/migrations/20261114130000_remove_user_tunnels/migration.sql"

function readRepoFile(path: string): string {
  return readFileSync(join(repositoryRoot, path), "utf8")
}

function sourceFiles(directory: string): string[] {
  return readdirSync(join(repositoryRoot, directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith(".ts") && !path.endsWith(".spec.ts") ? [path] : []
  })
}

describe("retired tunnel service", () => {
  it("has no server module, routes, transports, ingress listener or runtime configuration", () => {
    expect(existsSync(join(repositoryRoot, "server/src/tunnels"))).toBe(false)
    for (const path of sourceFiles("server/src")) {
      expect(readRepoFile(path), path).not.toMatch(/tunnel|\/api\/tunnels/iu)
    }
    const env = loadEnv({
      DATABASE_URL: "postgresql://fixture/fixture",
      ADMIN_ACCESS_SECRET: "Qv2jY7mD9kL4sN8pR3tW6xZ1cF5hJ0uB7eG2iM9oK4A",
      USER_ACCESS_JWT_SECRET: "user-secret-with-enough-length-32chars",
      TUNNEL_ENABLED: "true",
      TUNNEL_PUBLIC_DOMAIN: "retired.example.test",
      TUNNEL_INGRESS_PORT: "19703",
    })
    expect(Object.keys(env).filter(key => /tunnel/iu.test(key))).toEqual([])
  })

  it("removes deployment settings and certificate provisioning commands", () => {
    for (const path of [
      "server/compose.yml", "server/compose.dev.yml", "server/.env.example",
      "server/docker-entrypoint.sh", "server/nginx.conf", "scripts/dev/run-server-with-env.mjs",
      ".claude/rules/workspace-dev-ports.md",
    ]) {
      expect(readRepoFile(path), path).not.toMatch(/tunnel|19703|3002|内网穿透/iu)
    }
    for (const file of ["tunnel-edge-config.mjs", "tunnel-certificate-renew.sh", "tunnel-acme.py"]) {
      expect(existsSync(join(repositoryRoot, "server/scripts", file)), file).toBe(false)
    }
  })

  it("drops exactly the three dedicated tables in dependency order without touching accounts", () => {
    const schema = readRepoFile("server/prisma/schema.prisma")
    expect(schema).not.toMatch(/UserTunnel|TunnelDeviceCredential|tunnelOperations|tunnelDeviceCredentials/u)
    const sql = readRepoFile(retirementMigration).replace(/^--.*$/gmu, "").trim()
    expect(sql).toBe([
      "BEGIN;",
      'DROP TABLE "UserTunnelOperation";',
      'DROP TABLE "TunnelDeviceCredential";',
      'DROP TABLE "UserTunnel";',
      "COMMIT;",
    ].join("\n"))
    const originalMigration = readRepoFile("server/prisma/migrations/20261111100000_user_tunnels/migration.sql")
    expect(createHash("sha256").update(originalMigration).digest("hex")).toBe("e8058470b29f8d01c276463c227850860db965e6d6ff59f001542049dded9c8f")
  })
})
