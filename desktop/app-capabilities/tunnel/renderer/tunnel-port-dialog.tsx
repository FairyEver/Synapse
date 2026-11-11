import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
export function TunnelPortDialog({ port, pending, failure, onSave, onClose }: { port?: number; pending: boolean; failure: string | null; onSave(port: number): Promise<boolean>; onClose(): void }) {
  const [value, setValue] = useState(port?.toString() ?? ""), [invalid, setInvalid] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const number = Number(value)
    if (!/^\d+$/u.test(value) || !Number.isInteger(number) || number < 1 || number > 65535) { setInvalid(true); return }
    setInvalid(false)
    if (await onSave(number)) onClose()
  }
  return <Dialog open onOpenChange={open => { if (!open && !pending) onClose() }}>
    <DialogContent><form onSubmit={event => { void submit(event) }} className="space-y-4">
      <DialogHeader><DialogTitle>{port === undefined ? "申请链接" : "修改端口"}</DialogTitle><DialogDescription>{port === undefined ? "持有链接的人可直接访问此端口。" : "链接地址保持不变，现有连接将断开。"}</DialogDescription></DialogHeader>
      <div className="space-y-2"><Label htmlFor="tunnel-port">本机端口</Label><Input id="tunnel-port" aria-label="本机端口" required inputMode="numeric" type="number" min={1} max={65535} value={value} disabled={pending} aria-invalid={invalid} aria-describedby={invalid ? "tunnel-port-error" : undefined} onChange={event => setValue(event.currentTarget.value)} />
        {invalid && <p id="tunnel-port-error" role="alert" className="text-sm text-destructive">请输入 1–65535 的整数端口</p>}</div>
      {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
      <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={onClose}>取消</Button><Button type="submit" disabled={pending}>{pending ? "正在保存…" : port === undefined ? "申请" : "保存"}</Button></DialogFooter>
    </form></DialogContent>
  </Dialog>
}
