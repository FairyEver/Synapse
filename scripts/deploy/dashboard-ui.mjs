import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

/** 生产默认构建 V2；显式选择 v1 可整包回滚旧前端。 */
export function resolveDashboardBuild(value = "v2") {
  const ui = value === "" ? "v2" : value
  if (ui === "v1") return { ui, package: "@synapse/dashboard", directory: "dashboard" }
  if (ui === "v2") return { ui, package: "@synapse/dashboard-v2", directory: "dashboard-v2" }
  throw new Error("DASHBOARD_UI must be v1 or v2")
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const target = resolveDashboardBuild(process.argv[2])
    const field = process.argv[3] ?? "ui"
    if (!["ui", "package", "directory", "json"].includes(field)) throw new Error("Dashboard selector field must be ui, package, directory or json")
    process.stdout.write(`${field === "json" ? JSON.stringify({ ui: target.ui }) : target[field]}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Invalid dashboard build selection"}\n`)
    process.exitCode = 1
  }
}
