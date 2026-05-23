import { Button } from "@/components/ui/button"

interface PaginationFooterProps {
  readonly page: number
  readonly pageSize: number
  readonly total: number
  readonly onPageChange: (page: number) => void
}

export function PaginationFooter({ page, pageSize, total, onPageChange }: PaginationFooterProps) {
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>共 {total} 条</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          上一页
        </Button>
        <Button variant="outline" size="sm" disabled={page * pageSize >= total} onClick={() => onPageChange(page + 1)}>
          下一页
        </Button>
      </div>
    </div>
  )
}
