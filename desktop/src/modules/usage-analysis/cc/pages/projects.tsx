import { ProjectsReportView } from "../../shared/components/report-views"
import type { UsageRangePreset } from "../../shared/types"
import { useCcProjects } from "../hooks"

export function CcProjectsPage({ range, refreshKey }: { readonly range: UsageRangePreset; readonly refreshKey: number }) {
  return <ProjectsReportView state={useCcProjects(range, refreshKey)} />
}
