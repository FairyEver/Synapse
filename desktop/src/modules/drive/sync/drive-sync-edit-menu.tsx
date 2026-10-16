import type { DriveSyncBindingDto } from "@synapse/shared"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { SyncWizardEdit } from "./drive-sync-flow"

export function DriveSyncEditItems({
  binding,
  disabled,
  onEdit,
}: {
  readonly binding: DriveSyncBindingDto
  readonly disabled: boolean
  readonly onEdit: (edit: SyncWizardEdit) => void
}) {
  return (
    <>
      <DropdownMenuItem disabled={disabled} onSelect={() => onEdit("local")}>
        更换本地位置…
      </DropdownMenuItem>
      <DropdownMenuItem disabled={disabled} onSelect={() => onEdit("remote")}>
        {binding.kind === "file" ? "更换云端文件…" : "更换云端文件夹…"}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={disabled} onSelect={() => onEdit("align")}>
        重新选择对齐依据…
      </DropdownMenuItem>
      {binding.kind === "folder" && (
        <DropdownMenuItem disabled={disabled} onSelect={() => onEdit("range")}>
          修改同步范围…
        </DropdownMenuItem>
      )}
    </>
  )
}
export function DriveSyncEditMenu({
  onRequestRescan,
  onRequestRemove,
  rescanDisabled,
  ...props
}: Parameters<typeof DriveSyncEditItems>[0] & {
  readonly onRequestRescan: () => void
  readonly onRequestRemove: () => void
  readonly rescanDisabled: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="修改同步" disabled={props.disabled} variant="ghost">
          修改同步
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DriveSyncEditItems {...props} />
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={rescanDisabled} onSelect={onRequestRescan}>
            重新核对全部文件…
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" onSelect={onRequestRemove}>
            解除同步…
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
