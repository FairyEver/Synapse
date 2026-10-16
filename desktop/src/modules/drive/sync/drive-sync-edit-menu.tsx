import type { DriveSyncBindingDto } from "@synapse/shared"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { SyncWizardEdit } from "./drive-sync-flow"

export function DriveSyncEditItems({ binding, disabled, onEdit }: {
  readonly binding: DriveSyncBindingDto; readonly disabled: boolean
  readonly onEdit: (edit: SyncWizardEdit) => void
}) {
  return <>
    <DropdownMenuItem disabled={disabled} onSelect={() => onEdit("local")}>更换本地位置…</DropdownMenuItem>
    <DropdownMenuItem disabled={disabled} onSelect={() => onEdit("remote")}>{binding.kind === "file" ? "更换云端文件…" : "更换云端文件夹…"}</DropdownMenuItem>
    <DropdownMenuItem disabled={disabled} onSelect={() => onEdit("align")}>重新对齐…</DropdownMenuItem>
    {binding.kind === "folder" && <DropdownMenuItem disabled={disabled} onSelect={() => onEdit("range")}>修改同步范围…</DropdownMenuItem>}
  </>
}
export function DriveSyncEditMenu(props: Parameters<typeof DriveSyncEditItems>[0]) {
  return <DropdownMenu><DropdownMenuTrigger asChild><Button aria-label="修改同步" disabled={props.disabled} variant="outline">修改同步</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end"><DropdownMenuGroup><DriveSyncEditItems {...props} /></DropdownMenuGroup></DropdownMenuContent>
  </DropdownMenu>
}
