import { spawn } from "node:child_process"
import { pathToFileURL } from "node:url"

export function serverInfraArgs(env) {
  const buildArgs = env.SYNAPSE_SERVER_REUSE_INFRA === "1" ? ["--no-build"]
    : env.SYNAPSE_SERVER_REUSE_INFRA === "0" ? ["--build"] : []
  return ["compose", "--env-file", "server/.env.local", "-f", "server/compose.yml", "-f", "server/compose.dev.yml", "up", "-d",
    ...buildArgs, "postgres", "pdf-renderer"]
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const child = spawn("docker", serverInfraArgs(process.env), {
    stdio: "inherit", env: { ...process.env, PDF_RENDERER_INTERNAL_SECRET: process.env.PDF_RENDERER_INTERNAL_SECRET || "synapse-local-pdf-renderer-secret-not-for-production" },
  })
  child.on("error", error => { console.error("[server-infra]", error.message); process.exitCode = 1 })
  child.on("exit", code => { process.exitCode = code ?? 1 })
}
