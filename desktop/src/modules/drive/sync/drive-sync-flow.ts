export type SyncWizardOperation = "create" | "edit" | "remove"
export type SyncWizardScenario = "local_to_remote" | "remote_to_local" | "bind_existing"
export type SyncWizardEdit = "range" | "local" | "remote" | "align"
export type SyncWizardStep = "action" | "binding" | "edit" | "kind" | "scenario" | "local" | "remote" | "authority" | "range" | "confirm"
const titles: Record<SyncWizardStep, string> = {
  action: "选择操作", binding: "选择同步", edit: "选择修改内容", kind: "选择类型", scenario: "选择起始情况",
  local: "选择本地位置", remote: "选择云端位置", authority: "选择对齐依据", range: "同步范围", confirm: "检查并确认",
}
export function syncWizardSteps(operation: SyncWizardOperation | "", kind: "file" | "folder" | "", scenario: SyncWizardScenario | "", edit: SyncWizardEdit | "") {
  const steps: SyncWizardStep[] = ["action"]
  if (operation === "remove") steps.push("binding", "confirm")
  else if (operation === "edit") {
    steps.push("binding", "edit")
    if (edit === "range") steps.push("range", "confirm")
    else if (edit) {
      if (edit === "local" || edit === "remote") steps.push(edit)
      steps.push("authority", "confirm")
    }
  } else if (operation === "create") {
    steps.push("kind", "scenario")
    if (scenario === "remote_to_local") steps.push("remote", "local")
    else if (scenario) steps.push("local", "remote")
    if (scenario === "bind_existing") steps.push("authority")
    if (scenario && kind === "folder") steps.push("range")
    if (scenario) steps.push("confirm")
  }
  return steps.map((id) => ({ id, title: titles[id] }))
}
export function localSyncBasename(value: string) { return value.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? "" }
export function syncRemotePath(parent: string, name: string) { return `${parent.replace(/\/$/, "")}/${name}` }
export const alignmentActionLabels = { upload: "上传到云端", download: "下载到本地", delete_local: "移入本地回收站", delete_remote: "移入云端回收站" } as const
