import { FilePlus2, FolderPlus, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type AgentAttachmentMenuProps = {
  readonly disabled?: boolean
  readonly onChoose: (kind: "file" | "directory") => void
}

function AgentAttachmentMenu({ disabled, onChoose }: AgentAttachmentMenuProps) {
  return (
    <DropdownMenu data-track="agent-attachment-menu">
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="添加附件"
          title="添加附件"
          data-track="agent-attachment-menu"
          disabled={disabled}
        >
          <Plus />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownMenuItem onSelect={() => onChoose("file")}>
          <FilePlus2 data-icon="inline-start" />
          附加文件
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChoose("directory")}>
          <FolderPlus data-icon="inline-start" />
          附加文件夹
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { AgentAttachmentMenu }
