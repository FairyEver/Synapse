import * as React from "react"
import { PlusIcon } from "lucide-react"
import { PageState } from "@/components/page-state"
import { ManagedStatusSelect } from "@/components/status-select"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useApiResource } from "@/hooks/use-api-resource"
import { adminApi, type ManagedStatus } from "@/lib/api"
import { formatDate } from "@/lib/format"

export function ActivationCodesPage() {
  const { data, error, loading, reload } = useApiResource(adminApi.listActivationCodes)
  const [open, setOpen] = React.useState(false)
  const [code, setCode] = React.useState("")
  const [maxDevices, setMaxDevices] = React.useState("1")
  const [expiresAt, setExpiresAt] = React.useState("")
  const [createdCode, setCreatedCode] = React.useState<string | null>(null)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  async function createActivationCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const deviceCount = Number(maxDevices)
    if (!Number.isInteger(deviceCount) || deviceCount < 1) {
      setFormError("设备数无效")
      return
    }

    setSubmitting(true)
    setFormError(null)
    try {
      const result = await adminApi.createActivationCode({
        code,
        maxDevices: deviceCount,
        expiresAt: expiresAt || null,
      })
      setCreatedCode(result.code)
      setCode("")
      setMaxDevices("1")
      setExpiresAt("")
      setOpen(false)
      reload()
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "创建失败")
    } finally {
      setSubmitting(false)
    }
  }

  async function updateStatus(id: string, status: ManagedStatus) {
    await adminApi.updateActivationCode(id, status)
    reload()
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        {createdCode ? (
          <div className="text-sm text-muted-foreground">已创建：{createdCode}</div>
        ) : (
          <div />
        )}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <PlusIcon />
              新建
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新建激活码</DialogTitle>
            </DialogHeader>
            <form className="grid gap-4" onSubmit={createActivationCode}>
              <div className="grid gap-2">
                <Label htmlFor="activation-code">激活码</Label>
                <Input
                  id="activation-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="max-devices">设备数</Label>
                <Input
                  id="max-devices"
                  type="number"
                  min={1}
                  value={maxDevices}
                  onChange={(event) => setMaxDevices(event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="expires-at">到期日</Label>
                <Input
                  id="expires-at"
                  type="date"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
              </div>
              {formError ? <div className="text-sm text-destructive">{formError}</div> : null}
              <DialogFooter>
                <Button type="submit" disabled={submitting}>
                  保存
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      {loading ? <PageState>加载中</PageState> : null}
      {error ? <PageState>{error}</PageState> : null}
      {!loading && !error && data?.length === 0 ? <PageState>暂无激活码</PageState> : null}
      {data && data.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">设备数</TableHead>
              <TableHead>到期</TableHead>
              <TableHead>账号</TableHead>
              <TableHead>兑换</TableHead>
              <TableHead>创建</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <StatusBadge status={item.status} />
                </TableCell>
                <TableCell className="text-right">{item.maxDevices}</TableCell>
                <TableCell>{formatDate(item.expiresAt)}</TableCell>
                <TableCell>{item.boundAccountId ?? "无"}</TableCell>
                <TableCell>{formatDate(item.redeemedAt)}</TableCell>
                <TableCell>{formatDate(item.createdAt)}</TableCell>
                <TableCell>
                  <ManagedStatusSelect
                    value={item.status}
                    onChange={(next) => updateStatus(item.id, next)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  )
}
