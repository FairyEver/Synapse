import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

/** 默认保留现有前端；只有显式选择 v2 才构建 HeroUI 版本。 */
export function resolveDashboardBuild(value = "v1") {
  const ui = value === "" ? "v1" : value
  if (ui === "v1") return { ui, package: "@synapse/dashboard", directory: "dashboard" }
  if (ui === "v2") return { ui, package: "@synapse/dashboard-v2", directory: "dashboard-v2" }
  throw new Error("DASHBOARD_UI must be v1 or v2")
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const target = resolveDashboardBuild(process.argv[2])
    const field = process.argv[3] ?? "ui"
    if (!["ui", "package", "directory"].includes(field)) throw new Error("Dashboard selector field must be ui, package or directory")
    process.stdout.write(`${target[field]}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Invalid dashboard build selection"}\n`)
    process.exitCode = 1
  }
}
