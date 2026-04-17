import { ChevronRight, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type AppShellSidebarProps = {
  groups: string[]
}

function AppShellSidebar({ groups }: AppShellSidebarProps) {
  return (
    <div className="flex h-full flex-col gap-5 p-4">
      <div className="flex items-center gap-2">
        <Input placeholder="搜索分区..." className="min-w-0 flex-1" />
        <Button variant="outline" size="icon">
          <Plus className="size-4" />
          <span className="sr-only">创建分区</span>
        </Button>
      </div>

      <div className="space-y-2">
        <p className="px-1 text-sm font-medium text-muted-foreground">
          分类
        </p>
        <div className="space-y-1">
          {groups.map((group, index) => (
            <Button
              key={group}
              variant={index === 0 ? "secondary" : "ghost"}
              className="w-full justify-between"
            >
              <span>{group}</span>
              <ChevronRight className="size-4 shrink-0" />
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

export { AppShellSidebar }
