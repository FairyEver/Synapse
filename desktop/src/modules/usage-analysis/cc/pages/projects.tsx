import { ProjectsReportView } from "../../shared/components/report-views"
import type { UsageRangePreset } from "../../shared/types"
import { useCcProjects } from "../hooks"

export function CcProjectsPage({ range, refreshKey, refreshing }: { readonly range: UsageRangePreset; readonly refreshKey: number; readonly refreshing: boolean }) {
  return <ProjectsReportView state={useCcProjects(range, refreshKey)} refreshing={refreshing} />
}
