import { ChevronRight, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type AppShellSidebarProps = {
  groups: string[]
}

function AppShellSidebar({ groups }: AppShellSidebarProps) {
  return (
    <div className="flex h-full flex-col gap-5 p-4">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="搜索分区..." className="pl-8" />
        </div>
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
