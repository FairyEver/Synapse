export type SyncWizardOperation = "create" | "edit"
export type SyncWizardScenario = "local_to_remote" | "remote_to_local" | "bind_existing"
export type SyncWizardEdit = "range" | "local" | "remote" | "align"
export type SyncWizardStep = "edit" | "kind" | "scenario" | "local" | "remote" | "authority" | "range" | "confirm"
const titles: Record<SyncWizardStep, string> = {
  edit: "选择修改内容", kind: "选择类型", scenario: "选择起始情况",
  local: "选择本地位置", remote: "选择云端位置", authority: "选择对齐依据", range: "同步范围", confirm: "检查并确认",
}
export function syncWizardSteps(operation: SyncWizardOperation, kind: "file" | "folder" | "", scenario: SyncWizardScenario | "", edit: SyncWizardEdit | "", fromItem = false) {
  const steps: SyncWizardStep[] = []
  if (operation === "edit") {
    steps.push("edit")
    if (edit === "range") steps.push("range", "confirm")
    else if (edit) {
      if (edit === "local" || edit === "remote") steps.push(edit)
      steps.push("authority", "confirm")
    }
  } else {
    if (fromItem) steps.push("local")
    else {
      steps.push("scenario")
      if (scenario) steps.push("kind")
      if (scenario && kind) steps.push(...(scenario === "remote_to_local" ? ["remote", "local"] as const : ["local", "remote"] as const))
    }
    if (scenario && kind) {
      if (scenario === "bind_existing") steps.push("authority")
      if (kind === "folder") steps.push("range")
      steps.push("confirm")
    }
  }
  return steps.map((id) => ({ id, title: titles[id] }))
}
export function localSyncBasename(value: string) { return value.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? "" }
export function syncRemotePath(parent: string, name: string) { return `${parent.replace(/\/$/, "")}/${name}` }
export const alignmentActionLabels = { upload: "上传到云端", download: "下载到本地", delete_local: "移入本地回收站", delete_remote: "移入云端回收站" } as const
