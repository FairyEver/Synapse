import { Dialog, DialogContent, DialogFrame, DialogFrameHeader, DialogFrameBody, DialogFrameFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { useDepartmentPicker } from "./use-department-picker"
import type { DepartmentMember } from "./department-recipients"
import { mailError } from "./api"

export function DepartmentPicker({ onClose, onApply, disabled }: { onClose(): void; onApply(members: DepartmentMember[], excludeMissing: boolean): void; disabled: boolean }) {
  const model = useDepartmentPicker()
  const apply = () => {
    if (disabled || !model.members || model.loading) return
    try { onApply(model.members, model.excludeMissing); onClose() } catch (cause) { model.setError(mailError(cause)) }
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}><DialogContent aria-describedby={undefined} showCloseButton={false} className="h-[min(40rem,80vh)] gap-0 p-0"><DialogFrame><DialogFrameHeader title={model.selected ? `${model.selected.teamName} / ${model.selected.name}` : "选择部门"} /><DialogFrameBody className="space-y-3 overflow-y-auto px-5 pb-4">
    {!model.selected && <><Label htmlFor="mail-department-search">部门或团队</Label><Input id="mail-department-search" value={model.query} onChange={event => model.search(event.target.value)} /></>}
    {model.loading && <p role="status" className="text-sm text-muted-foreground">正在读取{model.selected ? "全部成员" : "部门"}…</p>}
    {model.error && <div role="alert" className="space-y-2"><p className="text-sm text-destructive">{model.error}</p><Button variant="outline" onClick={model.retry}>重试</Button></div>}
    <div className="min-h-0 flex-1 overflow-y-auto">
      {!model.selected && model.items.map(item => <Button key={item.organizationId} variant="ghost" className="h-auto w-full justify-between gap-3 py-3" onClick={() => model.select(item)}><span className="min-w-0 truncate">{item.teamName} / {item.name}</span><span className="shrink-0 text-muted-foreground">{item.memberCount} 人</span></Button>)}
      {!model.loading && !model.error && !model.selected && !model.items.length && <p className="text-sm text-muted-foreground">没有匹配的部门</p>}
      {model.members?.map(member => <div key={member.userId} className="border-b py-2 text-sm"><p>{member.name}</p><p className={member.issue ? "text-destructive" : "break-all text-muted-foreground"}>{member.issue ?? member.address?.address}</p></div>)}
    </div>
    {model.members && <p className="text-sm text-muted-foreground">包含子部门，共 {model.members.length} 人。确认后展开为实际邮箱地址。</p>}
    {model.missing.length > 0 && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{model.missing.length} 人没有可用的联系邮箱，无法向完整部门发送。</p><div className="flex items-center gap-2"><Checkbox id="mail-department-exclude" checked={model.excludeMissing} onCheckedChange={value => model.setExcludeMissing(value === true)} /><Label htmlFor="mail-department-exclude">排除上述无可用邮箱的 {model.missing.length} 人，仅添加其余成员</Label></div></div>}
    </DialogFrameBody><DialogFrameFooter>{model.selected && <Button variant="outline" onClick={() => model.select(null)}>返回部门</Button>}<Button variant="outline" onClick={onClose}>取消</Button>{model.selected && <Button onClick={apply} disabled={disabled || model.loading || !model.members?.some(member => member.address) || !!model.missing.length && !model.excludeMissing}>添加收件人</Button>}</DialogFrameFooter>
  </DialogFrame></DialogContent></Dialog>
}
