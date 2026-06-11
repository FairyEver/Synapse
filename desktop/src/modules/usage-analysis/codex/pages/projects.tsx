import { ProjectsReportView } from "../../shared/components/report-views"
import type { UsageRangePreset } from "../../shared/types"
import { useCodexProjects } from "../hooks"

export function CodexProjectsPage({ range, refreshKey, refreshing }: { readonly range: UsageRangePreset; readonly refreshKey: number; readonly refreshing: boolean }) {
  return <ProjectsReportView state={useCodexProjects(range, refreshKey)} refreshing={refreshing} />
}
