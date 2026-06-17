import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

export function GitModule() {
  return (
    <div className="flex h-full items-center justify-center bg-surface p-6">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Git</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>暂无仓库。</EmptyContent>
      </Empty>
    </div>
  )
}
