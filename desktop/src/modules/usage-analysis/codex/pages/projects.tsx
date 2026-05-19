import { ProjectsReportView } from "../../shared/components/report-views"
import type { UsageRangePreset } from "../../shared/types"
import { useCodexProjects } from "../hooks"

export function CodexProjectsPage({ range, refreshKey }: { readonly range: UsageRangePreset; readonly refreshKey: number }) {
  return <ProjectsReportView state={useCodexProjects(range, refreshKey)} />
}
