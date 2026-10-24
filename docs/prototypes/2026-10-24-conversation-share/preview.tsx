import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowLeft, ArrowDown, ArrowUp, Bell, Check, ChevronDown, ChevronRight, ChevronUp, CircleUserRound, Copy, Download, EllipsisVertical, ExternalLink, Folder, FolderOpen, Info, LoaderCircle, Mic, Plus, Share2, Terminal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFrame, DialogFrameHeader, DialogFrameBody, DialogFrameFooter } from '@/components/ui/dialog'
import { AgentMessageBubble } from '@/modules/agent/components/agent-message-bubble'
import { AgentComposerInputBox } from '@/modules/agent/components/agent-composer-input-box'
import { cn } from '@/lib/utils'
import agentIcon from '@/modules/agent/assets/icon.png'
import driveIcon from '@/modules/drive/assets/icon.png'
import settingsIcon from '@/modules/settings/assets/icon.png'
import workflowIcon from '@/modules/workflow/assets/icon.png'
import automationIcon from '@/modules/automation/assets/icon.png'
import repositoryIcon from '@/modules/resource-repository/assets/icon.png'
import mailInternalIcon from '@/modules/mail-internal/assets/icon.png'
import mailIcon from '@/modules/mail/assets/icon.png'
import appsIcon from '@/modules/apps/assets/icon.png'
import terminalIcon from '@capabilities/terminal/renderer/assets/icon.png'
// @ts-expect-error Virtual, pinned at build time; not an application dependency.
import { snapdom } from 'prototype-snapdom'

type Message = { id: number; role: 'user' | 'assistant'; time: string; summary: string }
type Settings = { title: string; width: number; scale: number; redact: boolean; showTitle: boolean; showTime: boolean; showModel: boolean; showBrand: boolean }
const messages: Message[] = [
  { id: 1, role: 'user', time: '18:22', summary: '统计最近一个月的收件量' },
  { id: 2, role: 'assistant', time: '18:23', summary: '收件分析与每日收件量图表' },
  { id: 3, role: 'user', time: '18:24', summary: '对比最近两周' },
  { id: 4, role: 'assistant', time: '18:24', summary: '最近两周收件量对比' },
  { id: 5, role: 'user', time: '18:25', summary: '给我一句话结论和处理建议' },
  { id: 6, role: 'assistant', time: '18:25', summary: '结论与三条处理建议' },
]
const defaults: Settings = { title: '最近一个月，我的邮箱有多忙？', width: 720, scale: 2, redact: true, showTitle: true, showTime: false, showModel: false, showBrand: true }
const values = [2,1,2,7,2,1,2,1,3,4,1,1,3,5,1,0,2,4,1,10,3,4,3,1,2,1,12,19,10,2,1]

function Brand({ small = false }: { small?: boolean }) {
  return <span aria-label="Synapse" className={cn('inline-flex shrink-0 items-center justify-center rounded-md bg-primary font-semibold tracking-tighter text-primary-foreground', small ? 'size-6 text-xs' : 'size-8 text-sm')}>Sy</span>
}

function MailChart() {
  return <figure className="mt-5" aria-label="每日收件量图表，10 月 21 日最高，19 封">
    <figcaption className="mb-3 font-semibold">每日收件量 <span className="ml-2 text-sm font-normal text-muted-foreground">单位：封</span></figcaption>
    <svg viewBox="0 0 620 250" role="img" aria-label="最近一个月每日收件量" className="block h-auto w-full overflow-visible text-muted-foreground">
      {[0, 5, 10, 15, 20].map((n) => <g key={n}><line x1="30" x2="612" y1={214 - n * 9} y2={214 - n * 9} className="stroke-border" strokeDasharray="3 4" /><text x="20" y={218 - n * 9} textAnchor="end" fontSize="12" fill="currentColor">{n}</text></g>)}
      {values.map((n, i) => <rect key={i} x={35 + i * 18.5} y={214 - n * 9} width="11" height={Math.max(n * 9, 1)} rx="3" className={i === 27 ? 'fill-chart-1' : 'fill-chart-1/30'} />)}
      <text x="540" y="29" textAnchor="middle" fontSize="14" fontWeight="600" className="fill-foreground">19</text>
      {[[0,'9/24'],[7,'10/1'],[14,'10/8'],[21,'10/15'],[27,'10/21'],[30,'10/24']].map(([i, day]) => <text key={day} x={40 + Number(i) * 18.5} y="242" textAnchor="middle" fontSize="11" fill="currentColor">{day}</text>)}
    </svg>
  </figure>
}

function MessageBody({ id, redact = false }: { id: number; redact?: boolean }) {
  if (id === 1) return <p>你去看一看我的邮箱，把我最近一个月收到的邮件数量按天做一个图形化分析，看看我哪一天收到的邮件最多。</p>
  if (id === 2) return <>
    <p>我已经查完了。用你的阿里企业邮箱（<span className={cn('break-all', redact ? 'rounded bg-muted px-1 text-muted-foreground' : 'underline underline-offset-4')}>{redact ? '［邮箱已隐藏］' : 'demo@example.com'}</span>）统计了收件箱 <strong>2026-09-24 ~ 2026-10-24</strong> 共 31 天的收件情况，合计 <strong>111 封</strong>（垃圾邮件箱里的 7 封没有算进去）。</p>
    <p className="mt-4"><strong>收件最多的一天是 10 月 21 日，19 封</strong>，大约是日均（3.6 封）的 5 倍。次高是 10 月 20 日 12 封，10 月 13 日和 10 月 22 日各有 10 封。</p>
    <h3 className="mt-6 text-base font-semibold">收件箱每日收件量 · 最近一个月</h3>
    <p className="mt-1 text-sm text-muted-foreground">2026-09-24 ~ 2026-10-24（本地时区）· 共 111 封</p>
    <div className="mt-5 grid grid-cols-3 gap-4">
      {[['收件最多的一天', '10 月 21 日', '19 封'], ['次高', '10 月 20 日', '12 封'], ['日均收件', '3.6 封', '31 天口径']].map(([label, value, detail]) => <div key={label}><p className="text-sm">{label}</p><p className="mt-3 text-xl font-medium">{value}</p><span className="mt-2 inline-block rounded-md bg-muted px-1.5 py-0.5 text-xs">{detail}</span></div>)}
    </div>
    <MailChart />
    <p className="mt-4">高峰集中在 10 月 20 日至 22 日，这三天合计 <strong>41 封</strong>，占本月总收件量的 36.9%。</p>
  </>
  if (id === 3) return <p>最近这一周和上一周比起来，邮件多了多少？</p>
  if (id === 4) return <>
    <p>最近一周收件 <strong>47 封</strong>，比上一周多 <strong>21 封</strong>，增长约 80.8%。</p>
    <table className="mt-4 w-full border-collapse text-sm"><thead><tr className="border-b"><th className="py-3 text-left font-medium">时间范围</th><th className="text-right font-medium">收件量</th><th className="text-right font-medium">日均</th></tr></thead><tbody><tr className="border-b"><td className="py-3">10 月 11 日 – 17 日</td><td className="text-right tabular-nums">26 封</td><td className="text-right tabular-nums">3.7 封</td></tr><tr className="border-b"><td className="py-3">10 月 18 日 – 24 日</td><td className="text-right tabular-nums">47 封</td><td className="text-right tabular-nums">6.7 封</td></tr></tbody></table>
    <p className="mt-4">增量主要来自 10 月 20 日至 22 日的集中来信。</p>
  </>
  if (id === 5) return <p>帮我总结成一句话，再给三个处理建议。</p>
  return <>
    <p><strong>一句话结论：</strong>最近一周邮件明显增多，主要集中在 10 月 20 日至 22 日。</p>
    <ol className="mt-4 list-decimal space-y-2 pl-6"><li>每天固定两个时段集中处理邮件。</li><li>把重要联系人的来信单独归类。</li><li>为高频通知建立自动筛选规则。</li></ol>
  </>
}

function Segment({ label, value, options, onChange }: { label: string; value: number; options: { value: number; label: string }[]; onChange: (value: number) => void }) {
  return <div className="space-y-2"><p className="text-sm font-medium">{label}</p><div role="group" aria-label={label} className="flex gap-1 rounded-lg bg-muted p-1">{options.map((item) => <Button key={item.value} variant={value === item.value ? 'outline' : 'ghost'} className="flex-1" aria-pressed={value === item.value} onClick={() => onChange(item.value)}>{item.label}</Button>)}</div></div>
}

function Toggle({ label, id, checked, onChange }: { label: string; id: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="flex items-center justify-between gap-4 py-2"><Label htmlFor={id} className="font-normal">{label}</Label><Switch id={id} checked={checked} onCheckedChange={onChange} /></div>
}

function DesignNotes({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent showCloseButton={false} className="h-[min(800px,90dvh)] max-w-3xl p-0 sm:max-w-3xl"><DialogFrame>
    <DialogFrameHeader title="方案与技术选型" description="评审原型 · 2026 年 10 月 24 日 · 使用模拟对话" bordered />
    <DialogFrameBody className="overflow-y-auto p-6 text-sm leading-7">
      <h2 className="text-lg font-semibold">从消息出发，分享一段对话</h2>
      <p className="mt-2">保留真实 SY 的侧栏、单行顶栏、原始对话排版、悬浮输入框和底部 Dock。顶栏增加分享图标，进入后在原消息旁勾选；底部输入框原位切换为选择操作栏。选择完成才打开图片预览弹窗，不再压缩成多栏工作台。</p>
      <p className="mt-2">顶栏入口不自动选择内容；单条消息的分享图标只预选该消息。支持「最近一轮」快捷选择。关闭预览返回原位置，选择和设置均保留；预览返回和取消分享是两个独立操作。</p>
      <h3 className="mt-6 font-semibold">选择与上下文</h3>
      <p className="mt-2">支持逐条勾选、按轮选择、全选、仅 AI、清空及 Shift 连续选择。跳过消息时保留「已省略内容」标记，避免误读。默认不含工具调用、思考过程、权限卡和日志；被引用的文件内容不自动附带。</p>
      <h3 className="mt-6 font-semibold">图片与清晰度</h3>
      <p className="mt-2">默认 PNG、720px 版式、2× 输出，即 1440px 宽。3× 输出为 2160px；宽版 960px × 3 输出为 2880px。预览缩放与导出分辨率独立；放大截图本身不能补回原图细节。代码完整换行，表格保持列结构，图表等待渲染完成。</p>
      <h3 className="mt-6 font-semibold">隐私与真实状态</h3>
      <p className="mt-2">默认隐藏邮箱，原对话保持不变。本原型只演示邮箱替换，不声称能识别所有敏感内容。正式版应在预览中逐项确认，并支持手动遮挡。图片只在本机生成，不创建公开链接。流式回复结束后才能导出该条消息。</p>
      <h3 className="mt-6 font-semibold">导出</h3>
      <p className="mt-2">复制写入 PNG 图片；保存下载 PNG 文件。复制受浏览器安全环境及权限影响，失败后可保存，不能显示虚假的成功提示。正式客户端应复用窄 preload bridge 完成剪贴板和保存对话框，遵守 PermissionGuard / AuditSink。调试包的现有导出入口保持独立。</p>
      <h3 className="mt-6 font-semibold">GitHub 核验结果</h3>
      <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[500px] border-collapse text-left"><thead><tr className="border-b text-muted-foreground"><th className="py-2 font-normal">项目</th><th className="font-normal">Stars</th><th className="font-normal">最新正式版</th><th className="font-normal">发布日期（UTC）</th></tr></thead><tbody>
        {[
          ['SnapDOM','8,205','3.3.7','2026-10-22','zumerlab/snapdom'],
          ['html-to-image','7,259','1.11.13','2025-02-14','bubkoo/html-to-image'],
          ['modern-screenshot','2,089','4.7.0','2026-04-16','qq15725/modern-screenshot'],
          ['html2canvas','31,928','1.4.1','2022-01-22','niklasvh/html2canvas'],
        ].map(([name, stars, version, date, repo]) => <tr key={name} className="border-b"><td className="py-2"><a className="underline underline-offset-4" href={`https://github.com/${repo}`} target="_blank" rel="noreferrer">{name}</a></td><td className="tabular-nums">{stars}</td><td>{version}</td><td>{date}</td></tr>)}
      </tbody></table></div>
      <p className="mt-3">推荐先验证 SnapDOM 3.3.7：MIT 协议，近期活跃，支持 SVG/Canvas、高清 PNG 与长图分窗口编码。它不是总 stars 最高的项目。原型已内嵌该版本，可离线使用；没有向应用添加依赖。</p>
      <p className="mt-2">作者的跑分不是 Synapse 的实测。本轮未测试真实对话截图速度。正式接入前，按相同尺寸、DPR、格式分别测首次 / 重复导出和长文、表格、代码、图表；现有 html-to-image 可作为对照。</p>
      <h3 className="mt-6 font-semibold">正式接入的验收边界</h3>
      <p className="mt-2">基于 message ID 冻结分享快照；加载完整历史后才允许全选。脱离虚拟列表和滚动容器，在独立导出画布排版。跨域或不可捕获的图表必须生成静态图，失败要明确标识。超长内容超出剪贴板预算时引导保存或按消息边界分图；禁止静默降清晰度、裁掉代码或漏掉图片。</p>
      <p className="mt-6 border-t pt-4 text-muted-foreground">本次仅交付交互原型和设计说明，尚未接入正式客户端、MCP 或云端分享服务。</p>
    </DialogFrameBody>
  </DialogFrame></DialogContent></Dialog>
}

function App() {
  const [sharing, setSharing] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [settings, setSettings] = useState(defaults)
  const [notes, setNotes] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const timeline = useRef<HTMLDivElement>(null)
  const resizeCleanup = useRef<(() => void) | null>(null)
  const [fullSize, setFullSize] = useState(false)
  const [availableWidth, setAvailableWidth] = useState(620)
  const [paperHeight, setPaperHeight] = useState(0)
  const [busy, setBusy] = useState<'copy' | 'save' | null>(null)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const anchor = useRef<number | null>(null)
  const [paperElement, setPaperElement] = useState<HTMLElement | null>(null)
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null)
  const active = messages.filter((message) => selected.has(message.id))
  const zoom = fullSize ? 1 : Math.min(1, Math.max(0.1, (availableWidth - 64) / settings.width))
  const change = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((previous) => ({ ...previous, [key]: value }))

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), notice.error ? 9000 : 4500)
    return () => clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && sharing && !previewOpen && !notes && !busy) setSharing(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sharing, notes, busy, previewOpen])
  useEffect(() => () => resizeCleanup.current?.(), [])
  useLayoutEffect(() => {
    const measure = () => {
      if (viewportElement) setAvailableWidth(viewportElement.clientWidth || 620)
      if (paperElement) setPaperHeight(paperElement.offsetHeight)
    }
    const observer = new ResizeObserver(measure)
    if (viewportElement) observer.observe(viewportElement)
    if (paperElement) observer.observe(paperElement)
    measure()
    return () => observer.disconnect()
  }, [viewportElement, paperElement])

  function enterShare(ids: number[] = []) {
    setSelected(new Set(ids)); anchor.current = null; setSharing(true)
  }
  function choose(id: number, checked: boolean, range = false) {
    setSelected((previous) => {
      const next = new Set(previous)
      const first = range && anchor.current !== null ? Math.min(anchor.current, id) : id
      const last = range && anchor.current !== null ? Math.max(anchor.current, id) : id
      for (let current = first; current <= last; current++) checked ? next.add(current) : next.delete(current)
      return next
    })
    anchor.current = id
  }
  function preset(ids: number[]) { setSelected(new Set(ids)); anchor.current = null }

  async function renderImage(): Promise<Blob> {
    if (!paperElement || !active.length) throw new Error('请先选择消息')
    const host = document.createElement('div')
    host.className = 'fixed -left-[20000px] top-0 pointer-events-none'
    host.setAttribute('aria-hidden', 'true')
    const clone = paperElement.cloneNode(true) as HTMLElement
    clone.removeAttribute('id')
    host.append(clone)
    document.body.append(host)
    try {
      await document.fonts?.ready
      const expectedWidth = clone.offsetWidth * settings.scale
      const expectedHeight = clone.offsetHeight * settings.scale
      const capture = await snapdom(clone, { dpr: 1, scale: settings.scale, embedFonts: false, fast: false, backgroundColor: getComputedStyle(clone).backgroundColor })
      const blob: Blob = await capture.toBlob({ format: 'png', scale: settings.scale, dpr: 1 })
      if (!blob || blob.type !== 'image/png' || !blob.size) throw new Error('未能生成 PNG，请重试')
      const header = new DataView(await blob.slice(0, 24).arrayBuffer())
      if (header.getUint32(16) !== expectedWidth || header.getUint32(20) !== expectedHeight) throw new Error('图片尺寸未达到设定清晰度，请缩小分享范围后重试')
      if (capture.warnings?.length) throw new Error('部分内容未能完整渲染，请缩小范围后重试')
      return blob
    } finally { host.remove() }
  }

  async function exportImage(kind: 'copy' | 'save') {
    if (busy || !active.length) return
    setBusy(kind); setNotice(null)
    try {
      if (kind === 'copy') {
        if (!window.isSecureContext || !navigator.clipboard?.write || !window.ClipboardItem) throw new Error('当前环境不能复制图片，请使用「保存图片」')
        if (settings.width * paperHeight * settings.scale ** 2 > 32_000_000) throw new Error('图片过长，建议保存到电脑后分享')
        // Start clipboard.write during the click gesture, before asynchronous rendering.
        const result = renderImage()
        void result.catch(() => undefined) // clipboard may reject before consuming the promise.
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': result })])
        setNotice({ text: '图片已复制，可直接粘贴分享' })
      } else {
        const blob = await renderImage()
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `${(settings.title.trim() || 'Synapse 对话').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 60)}-${settings.scale}x.png`
        document.body.append(link); link.click(); link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 30_000)
        setNotice({ text: '已发起图片下载，请查看浏览器下载列表' })
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知错误'
      setNotice({ text: kind === 'copy' && /NotAllowed|permission|denied/i.test(detail) ? '未获得剪贴板权限，请使用「保存图片」' : `导出失败：${detail}`, error: true })
    } finally { setBusy(null) }
  }

  function startSidebarResize(event: { preventDefault: () => void; clientX: number }) {
    event.preventDefault()
    resizeCleanup.current?.()
    const start = event.clientX
    const width = sidebarWidth
    const move = (pointer: PointerEvent) => setSidebarWidth(Math.max(220, Math.min(420, width + pointer.clientX - start)))
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      resizeCleanup.current = null
    }
    resizeCleanup.current = stop
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
  }
  function toggleRound(round: number) {
    const ids = [round * 2 + 1, round * 2 + 2]
    const all = ids.every((id) => selected.has(id))
    setSelected((previous) => {
      const next = new Set(previous)
      ids.forEach((id) => all ? next.delete(id) : next.add(id))
      return next
    })
    anchor.current = null
  }
  function existingAction() { setNotice({ text: '此原型仅演示对话分享' }) }
  const projects = ['本地对话', 'AI协作', '知刻', 'Synapse', 'BrickLab', 'Projects_Js', 'JS_01 小慧', 'JS_02 养鸡工厂', 'JS_03 人力', 'JS_04 规范', 'JS_05 流程', '公司文档仓库', '演示知识库', '私人知识库', 'headless', '芋道', 'Mall_Platform_Java', '06 代码审核']
  const dock = [
    ['用户对话', agentIcon], ['云盘', driveIcon], ['设置', settingsIcon], ['工作流', workflowIcon], ['终端', terminalIcon],
    ['自动化', automationIcon], ['资源仓库', repositoryIcon], ['站内信', mailInternalIcon], ['邮箱', mailIcon], ['应用', appsIcon],
  ]

  return <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
    <header aria-label="桌面窗口标题栏" className="flex h-8 shrink-0 items-center gap-4 border-b px-3">
      <div aria-hidden="true" className="flex items-center gap-2"><span className="size-3 rounded-full bg-destructive" /><span className="size-3 rounded-full bg-chart-4" /><span className="size-3 rounded-full bg-chart-3" /></div>
      <span className="truncate text-sm font-semibold text-foreground/70">Synapse AI Studio 1.0.79 dev</span>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setNotes(true)}><Info className="size-3.5" />原型说明</Button>
    </header>
    <div className="flex min-h-0 flex-1">
      <aside aria-label="项目侧栏" data-desktop-sidebar className="relative hidden shrink-0 bg-background p-2 md:block" style={{ width: sidebarWidth }}>
        <div className="h-full overflow-y-auto py-0.5">
          <div className="px-2 pb-2"><div className="flex h-7 items-center justify-between rounded-lg border border-input px-2.5 text-sm">用户对话<ChevronDown className="size-4 text-muted-foreground" /></div></div>
          <div className="space-y-0.5">{projects.map((name, index) => <Fragment key={name}>
            <div className="flex h-8 shrink-0 items-center rounded-lg px-2 text-sm font-medium text-foreground/80">
              {index === 0 ? <FolderOpen className="mr-2 size-4 shrink-0 text-muted-foreground" /> : <Folder className="mr-2 size-4 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <Button variant="ghost" size="icon-xs" aria-label={`在${name}中新建对话`} onClick={existingAction}><Plus /></Button><Button variant="ghost" size="icon-xs" aria-label={`${name}菜单`} onClick={existingAction}><EllipsisVertical /></Button>
            </div>
            {index === 0 && <div className="pt-0.5 pl-3"><div className="flex h-8 items-center gap-2 rounded-lg bg-selected px-2 text-xs"><span className="min-w-0 flex-1 truncate">你去看一看我的邮箱，…</span><span className="shrink-0 text-muted-foreground">18 分钟前</span></div></div>}
          </Fragment>)}</div>
        </div>
        <div role="separator" aria-label="调整项目侧栏宽度" aria-orientation="vertical" className="absolute inset-y-0 right-0 z-10 w-px cursor-col-resize bg-border before:absolute before:inset-y-0 before:-inset-x-1" onPointerDown={startSidebarResize} />
      </aside>
      <main aria-label="对话工作区" className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background px-2 py-2.5">
        <div aria-label="对话顶栏" data-conversation-header className="flex shrink-0 items-center justify-between gap-2">
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">你去看一看我的邮箱，把我最近一个月收到的邮件数量按天做一个图形化分析，看看我哪一天收到的邮件最多。</h1>
          <div className="flex shrink-0 items-center gap-0">
            <span className="hidden px-1 text-xs text-muted-foreground sm:block">DeepSeek deepseek-flash[1M]</span>
            <div aria-label="上下文使用量" className="mx-1 hidden h-1 w-16 overflow-hidden rounded-full bg-muted lg:block"><div className="h-full w-1 bg-primary" /></div>
            <Button variant="ghost" size="icon" aria-label="在 Claude Code 中继续" title="在 Claude Code 中继续" onClick={existingAction}><Terminal /></Button>
            <Button variant="ghost" size="icon" aria-label="复制对话" title="复制对话" onClick={existingAction}><Copy /></Button>
            <Button variant="ghost" size="icon" aria-label="导出对话调试包" title="导出对话调试包" onClick={existingAction}><Download /></Button>
            <Button variant={sharing ? 'secondary' : 'ghost'} size="icon" aria-label="分享对话" title="分享对话" aria-pressed={sharing} onClick={() => sharing ? setSharing(false) : enterShare()}><Share2 /></Button>
            <Button variant="ghost" size="icon" aria-label="新窗口打开" title="新窗口打开" onClick={existingAction}><ExternalLink /></Button>
          </div>
        </div>
        <div className="relative flex min-h-0 min-w-0 flex-1">
          <div ref={timeline} className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden" tabIndex={0} aria-label="对话消息">
            <div data-timeline-content className="mx-auto flex min-w-0 max-w-4xl flex-col gap-2 px-4 pt-4 pb-40">
              {messages.map((message, index) => <Fragment key={message.id}>
                {sharing && index % 2 === 0 && <div className="flex h-7 items-center justify-between px-1"><span className="text-xs text-muted-foreground">第 {index / 2 + 1} 轮</span><Button variant="ghost" size="xs" onClick={() => toggleRound(index / 2)}>{[message.id, message.id + 1].every((id) => selected.has(id)) ? '取消本轮' : '选择本轮'}</Button></div>}
                {message.id === 2 && <div className="mt-5 flex h-7 items-center gap-1.5 text-xs text-muted-foreground"><span>已处理</span><span>48s</span><ChevronRight className="size-3.5" /></div>}
                <article id={`source-message-${message.id}`} data-message={message.id} className={cn('group/message relative min-w-0', sharing && 'rounded-lg pl-8', sharing && selected.has(message.id) && 'bg-muted/50')}>
                  {sharing && <Checkbox className="absolute top-4 left-1" aria-label={`选择第 ${message.id} 条消息：${message.summary}`} checked={selected.has(message.id)} onClick={(event) => { event.preventDefault(); choose(message.id, !selected.has(message.id), event.shiftKey) }} />}
                  {message.role === 'user' ? <div className="flex min-w-0 flex-col items-end">
                    <AgentMessageBubble role="user"><MessageBody id={message.id} /></AgentMessageBubble>
                    <div className="mt-1 flex h-6 items-center gap-2 text-xs text-muted-foreground opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100"><time>{message.time}</time>{!sharing && <><Button variant="ghost" size="icon-xs" aria-label={`复制第 ${message.id} 条消息`} onClick={existingAction}><Copy /></Button><Button variant="ghost" size="icon-xs" aria-label={`分享第 ${message.id} 条消息`} onClick={() => enterShare([message.id])}><Share2 /></Button></>}</div>
                  </div> : <div className="flex w-full min-w-0 flex-col items-start">
                    <div className="mb-1 flex h-6 items-center gap-2"><span aria-label="Synapse" className="inline-flex size-5 items-center justify-center rounded bg-primary text-xs font-semibold tracking-tighter text-primary-foreground">Sy</span><time className="text-xs text-muted-foreground">{message.time}</time></div>
                    <div className="w-full min-w-0 px-1 py-2 text-sm leading-7 break-words"><MessageBody id={message.id} /></div>
                    {!sharing && <div className="flex h-6 w-full justify-end gap-1 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100"><Button variant="ghost" size="icon-xs" aria-label={`复制第 ${message.id} 条消息`} onClick={existingAction}><Copy /></Button><Button variant="ghost" size="icon-xs" aria-label={`分享第 ${message.id} 条消息`} onClick={() => enterShare([message.id])}><Share2 /></Button></div>}
                  </div>}
                </article>
              </Fragment>)}
            </div>
          </div>
          <div data-composer-position className="absolute inset-x-4 bottom-2.5 z-10 mx-auto max-w-2xl md:inset-x-20">
            {sharing ? <AgentComposerInputBox
              editor={<div className="flex min-h-9 items-center justify-between gap-2 px-2"><span className="text-sm font-medium" aria-live="polite">已选择 {active.length} 条消息</span><div className="flex items-center gap-2"><span className="hidden text-xs text-muted-foreground sm:inline">Shift 连选</span><Button variant="ghost" onClick={() => setSharing(false)}>取消</Button></div></div>}
              leadingActions={<div className="flex flex-wrap gap-0.5"><Button variant="ghost" onClick={() => preset(messages.map((m) => m.id))}>全选</Button><Button variant="ghost" onClick={() => preset([2, 4, 6])}>仅 AI</Button><Button variant="ghost" onClick={() => preset([5, 6])}>最近一轮</Button><Button variant="ghost" onClick={() => preset([])}>清空</Button></div>}
              trailingActions={<Button disabled={!active.length} onClick={() => { setFullSize(false); setPreviewOpen(true) }}>预览图片<ChevronRight /></Button>}
            /> : <>
              <Button variant="outline" size="icon" aria-label="滚动到底部" className="absolute -top-11 left-1/2 -translate-x-1/2 rounded-full" onClick={() => timeline.current?.scrollTo({ top: timeline.current.scrollHeight, behavior: 'smooth' })}><ArrowDown /></Button>
              <AgentComposerInputBox
                editor={<div className="min-h-9 px-2 py-2 text-sm text-muted-foreground">输入消息</div>}
                leadingActions={<><Button variant="ghost" size="icon" aria-label="打开文件树" onClick={existingAction}><Folder /></Button><Button variant="ghost" size="icon" aria-label="添加附件" onClick={existingAction}><Plus /></Button><Button variant="ghost" onClick={existingAction}>快捷输入<ChevronUp /></Button></>}
                trailingActions={<><Button variant="ghost" className="hidden text-muted-foreground sm:inline-flex" onClick={existingAction}>跳过权限确认<ChevronDown /></Button><Button variant="ghost" size="icon" aria-label="语音输入" onClick={existingAction}><Mic /></Button><Button variant="secondary" size="icon" className="rounded-full" aria-label="发送" onClick={existingAction}><ArrowUp /></Button></>}
              />
            </>}
          </div>
        </div>
      </main>
    </div>
    <footer aria-label="应用 Dock" data-desktop-dock className="grid min-h-12 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,max-content)_minmax(0,1fr)] items-center gap-2 border-t border-sidebar-border/50 bg-muted/30 px-3">
      <div />
      <nav aria-label="系统应用" className="flex min-w-0 items-center justify-center overflow-x-auto">{dock.map(([name, icon], index) => <Button key={name} variant="ghost" size="icon" className="relative size-12 shrink-0 hover:bg-transparent" aria-label={name} aria-current={index === 0 ? 'page' : undefined} onClick={existingAction}><img src={icon} alt="" className="size-10 object-contain" />{index === 0 && <span className="absolute bottom-0 left-1/2 size-1 -translate-x-1/2 rounded-full bg-chart-1" />}</Button>)}</nav>
      <div className="flex items-center justify-end gap-1"><Button variant="ghost" size="icon" aria-label="消息中心" onClick={existingAction}><Bell /></Button><Button variant="ghost" size="icon" aria-label="账户" onClick={existingAction}><CircleUserRound /></Button></div>
    </footer>

    <Dialog open={previewOpen} onOpenChange={(open) => { if (!busy) setPreviewOpen(open) }}>
      <DialogContent showCloseButton={false} className="h-[min(860px,90dvh)] w-[calc(100%-3rem)] max-w-6xl gap-0 p-0 sm:max-w-6xl" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); event.stopPropagation() }} onPointerDownOutside={(event) => { if (busy) event.preventDefault() }}>
        <DialogFrame>
          <DialogFrameHeader bordered title="预览分享图片" description={`已选择 ${active.length} 条消息`} showCloseButton={!busy} leading={<Button variant="ghost" size="icon" aria-label="返回选择" disabled={!!busy} onClick={() => setPreviewOpen(false)}><ArrowLeft /></Button>} actions={<Button variant="ghost" disabled={!!busy} aria-pressed={fullSize} onClick={() => setFullSize((value) => !value)} className="tabular-nums">{fullSize ? '100% · 适应宽度' : `${Math.round(zoom * 100)}%`}</Button>} />
          <DialogFrameBody className="flex overflow-hidden">
            <div ref={setViewportElement} className="min-h-0 min-w-0 flex-1 overflow-auto bg-surface p-8" tabIndex={0} aria-label="可滚动的长图预览">
              <div className="mx-auto" style={{ width: settings.width * zoom, height: paperHeight * zoom }}><div className="origin-top-left" style={{ width: settings.width, transform: `scale(${zoom})` }}>
                <article ref={setPaperElement} id="share-paper" aria-label="待分享图片内容" className="overflow-hidden rounded-lg bg-background p-10 text-foreground" style={{ width: settings.width }}>
                  {settings.showTitle && <header className="mb-8 border-b pb-7"><p className="mb-3 text-sm text-muted-foreground">对话摘录</p><h2 className="break-words text-2xl leading-snug font-semibold">{settings.title.trim() || '对话摘录'}</h2>{settings.showTime && <p className="mt-3 text-sm text-muted-foreground">2026 年 10 月 24 日</p>}</header>}
                  <div className="space-y-8">{active.map((message, index) => <Fragment key={message.id}>
                    {index > 0 && message.id > active[index - 1].id + 1 && <div className="flex items-center gap-4 text-xs text-muted-foreground" data-omission><span className="h-px flex-1 bg-border" /><span>已省略内容</span><span className="h-px flex-1 bg-border" /></div>}
                    <section data-export-message={message.id}><div className="mb-3 flex items-center gap-2">{message.role === 'assistant' ? <Brand small /> : <span className="flex size-6 items-center justify-center rounded-md bg-muted text-xs font-medium">我</span>}<span className="text-sm font-medium">{message.role === 'assistant' ? 'Synapse' : '我'}</span>{settings.showModel && message.role === 'assistant' && <span className="ml-1 text-xs text-muted-foreground">DeepSeek</span>}{settings.showTime && <time className="ml-auto text-xs text-muted-foreground">{message.time}</time>}</div><div className={cn('text-lg leading-8 break-words', message.role === 'user' && 'rounded-lg bg-muted px-5 py-4')}><MessageBody id={message.id} redact={settings.redact} /></div></section>
                  </Fragment>)}</div>
                  {settings.showBrand && <footer className="mt-10 flex items-center justify-between border-t pt-5 text-xs text-muted-foreground"><span className="flex items-center gap-2"><Brand small /><span>Synapse</span></span><span>对话摘录</span></footer>}
                </article>
              </div></div>
            </div>
            <aside aria-label="图片设置" className="w-56 shrink-0 overflow-y-auto border-l bg-background p-5 sm:w-60">
              <fieldset disabled={!!busy} className="space-y-6">
                <h2 className="text-sm font-semibold">图片设置</h2>
                <Segment label="清晰度" value={settings.scale} options={[{value:2,label:'高清 2×'},{value:3,label:'超清 3×'}]} onChange={(value) => change('scale', value)} />
                <Segment label="版式宽度" value={settings.width} options={[{value:720,label:'标准'},{value:960,label:'宽版'}]} onChange={(value) => change('width', value)} />
                <div><Toggle label="显示标题" id="show-title" checked={settings.showTitle} onChange={(value) => change('showTitle', value)} />{settings.showTitle && <Input aria-label="分享图片标题" maxLength={60} className="mt-2" value={settings.title} onChange={(event) => change('title', event.target.value)} />}</div>
                <div className="border-t pt-4"><Toggle label="隐藏邮箱" id="redact-email" checked={settings.redact} onChange={(value) => change('redact', value)} /><Toggle label="显示时间" id="show-time" checked={settings.showTime} onChange={(value) => change('showTime', value)} /><Toggle label="显示模型" id="show-model" checked={settings.showModel} onChange={(value) => change('showModel', value)} /><Toggle label="底部标识" id="show-brand" checked={settings.showBrand} onChange={(value) => change('showBrand', value)} /></div>
              </fieldset>
            </aside>
          </DialogFrameBody>
          <DialogFrameFooter className="flex-row items-center justify-between gap-3 border-t bg-background px-5 py-4 sm:justify-between">
            <div className="text-xs leading-5 text-muted-foreground"><p className="tabular-nums" data-resolution>{settings.width * settings.scale} × {Math.round(paperHeight * settings.scale)} px · PNG</p><p>{settings.redact ? '邮箱已隐藏' : '包含邮箱地址'} · 仅在本机生成</p></div>
            <div className="flex items-center gap-2"><Button variant="outline" disabled={!active.length || !!busy} onClick={() => void exportImage('copy')}>{busy === 'copy' ? <LoaderCircle className="animate-spin" /> : <Copy />}复制图片</Button><Button disabled={!active.length || !!busy} onClick={() => void exportImage('save')}>{busy === 'save' ? <LoaderCircle className="animate-spin" /> : <Download />}保存图片</Button></div>
          </DialogFrameFooter>
        </DialogFrame>
      </DialogContent>
    </Dialog>
    {notice && <div role={notice.error ? 'alert' : 'status'} className={cn('fixed right-5 bottom-5 z-50 flex max-w-[calc(100vw-40px)] items-start gap-3 rounded-lg border bg-popover p-4 text-sm text-popover-foreground', notice.error && 'border-destructive text-destructive')}>{notice.error ? <Info className="mt-0.5 size-4 shrink-0" /> : <Check className="mt-0.5 size-4 shrink-0" />}<span>{notice.text}</span><button aria-label="关闭提示" className="shrink-0 rounded focus-visible:ring-2" onClick={() => setNotice(null)}><X className="size-4" /></button></div>}
    <DesignNotes open={notes} onOpenChange={setNotes} />
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
