import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../src/components/ui/dialog"
import type { ConnectorItem } from "../shared/schema"

export function WecomConnectionInfoDialog({ item, open, onOpenChange }: {
  readonly item: ConnectorItem
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} data-track="connectors.wecom.info.dialog">
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>企业微信</DialogTitle>
          <DialogDescription>机器人已连接，凭据仅保存在本机。</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">状态</dt>
          <dd>已连接</dd>
          {item.wecom?.connectedAt ? (
            <>
              <dt className="text-muted-foreground">连接时间</dt>
              <dd>{formatTime(item.wecom.connectedAt)}</dd>
            </>
          ) : null}
          {item.wecom?.lastValidatedAt ? (
            <>
              <dt className="text-muted-foreground">最近检查</dt>
              <dd>{formatTime(item.wecom.lastValidatedAt)}</dd>
            </>
          ) : null}
        </dl>
        <p className="text-sm text-muted-foreground">
          业务权限由企业微信管理。请在“工作台 → 智能机器人 → 管理 → 可使用权限”中查看或申请。
        </p>
      </DialogContent>
    </Dialog>
  )
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
