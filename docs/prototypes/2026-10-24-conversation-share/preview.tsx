import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowLeft, ArrowUp, Check, ChevronDown, ChevronRight, Copy, Download, Folder, Image, Info, LoaderCircle, MessageSquare, PanelLeft, Plus, Share2, ShieldCheck, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFrame, DialogFrameHeader, DialogFrameBody } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
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
    <p>我已经查完了。邮箱 <span className={cn('break-all', redact && 'rounded bg-muted px-1 text-muted-foreground')}>{redact ? '［邮箱已隐藏］' : 'demo@example.com'}</span> 最近一个月共收到 <strong>111 封</strong>邮件。</p>
    <p className="mt-4">收件最多的一天是 <strong>10 月 21 日，19 封</strong>，约为日均的 5 倍；其次是 10 月 20 日，共 12 封。</p>
    <h3 className="mt-6 text-xl font-semibold">收件箱每日收件量 · 最近一个月</h3>
    <p className="mt-1 text-sm text-muted-foreground">2026/09/24 – 2026/10/24 · 共 111 封</p>
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
      <p className="mt-2">顶栏「分享」默认选中最近一轮完整问答。单条消息旁的分享图标仅选中该消息。左侧选择、右侧预览；可以独立选择用户消息或 AI 回复，始终按原对话顺序输出。</p>
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
  const [sharing, setSharing] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set([1, 2]))
  const [settings, setSettings] = useState(defaults)
  const [notes, setNotes] = useState(false)
  const [mobilePane, setMobilePane] = useState<'select' | 'preview'>('preview')
  const [showSettings, setShowSettings] = useState(false)
  const [fullSize, setFullSize] = useState(false)
  const [availableWidth, setAvailableWidth] = useState(620)
  const [paperHeight, setPaperHeight] = useState(0)
  const [busy, setBusy] = useState<'copy' | 'save' | null>(null)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const anchor = useRef<number | null>(null)
  const paper = useRef<HTMLElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
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
      if (event.key === 'Escape' && sharing && !notes && !busy) {
        if (showSettings) setShowSettings(false)
        else setSharing(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sharing, notes, busy, showSettings])
  useLayoutEffect(() => {
    const measure = () => {
      if (viewport.current) setAvailableWidth(viewport.current.clientWidth || 620)
      if (paper.current) setPaperHeight(paper.current.offsetHeight)
    }
    const observer = new ResizeObserver(measure)
    if (viewport.current) observer.observe(viewport.current)
    if (paper.current) observer.observe(paper.current)
    measure()
    return () => observer.disconnect()
  }, [sharing, selected, settings, mobilePane])

  function enterShare(ids = [5, 6]) {
    setSelected(new Set(ids)); anchor.current = null; setSharing(true); setMobilePane('preview')
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
    if (!paper.current || !active.length) throw new Error('请先选择消息')
    const host = document.createElement('div')
    host.className = 'fixed -left-[20000px] top-0 pointer-events-none'
    host.setAttribute('aria-hidden', 'true')
    const clone = paper.current.cloneNode(true) as HTMLElement
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

  return <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
    <div className="flex h-10 shrink-0 items-center justify-between border-b bg-muted/50 px-5 text-xs">
      <div className="flex items-center gap-2"><span className="font-medium">对话分享</span><span className="text-muted-foreground">/ 交互原型 · 示例数据</span></div>
      <Button variant="ghost" size="sm" onClick={() => setNotes(true)}><Info />方案与选型</Button>
    </div>
    <div className="flex min-h-0 flex-1">
      <aside aria-label="项目侧栏" className={cn('hidden w-48 shrink-0 flex-col border-r bg-sidebar md:flex', sharing && 'md:hidden 2xl:flex')}>
        <div className="flex h-16 items-center gap-2 px-4"><Brand small /><span className="text-sm font-semibold">Synapse</span></div>
        <div className="px-3"><div className="flex h-8 items-center justify-between rounded-lg border bg-background px-3 text-sm">用户对话<ChevronDown className="size-4 text-muted-foreground" /></div></div>
        <div className="mt-5 space-y-1 px-3 text-sm">
          <div className="flex h-8 items-center gap-2 px-1"><Folder className="size-4 text-muted-foreground" />本地对话<Plus className="ml-auto size-4 text-muted-foreground" /></div>
          <div className="ml-3 flex min-h-10 items-center gap-2 rounded-lg bg-sidebar-accent px-3 font-medium"><MessageSquare className="size-4 shrink-0" /><span className="truncate">邮箱收件分析</span></div>
          {['AI 协作', 'Synapse', 'BrickLab', '公司文档仓库'].map((name) => <div key={name} className="flex h-10 items-center gap-2 px-1"><Folder className="size-4 text-muted-foreground" />{name}<ChevronRight className="ml-auto size-3 text-muted-foreground" /></div>)}
        </div>
        <div className="mt-auto flex items-center gap-2 border-t p-4 text-xs text-muted-foreground"><PanelLeft className="size-4" />Synapse AI Studio</div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">{sharing && <Button variant="ghost" size="icon" aria-label="返回对话" disabled={!!busy} onClick={() => setSharing(false)}><ArrowLeft /></Button>}<div className="min-w-0"><h1 className="truncate text-base font-semibold">{sharing ? '分享对话' : '邮箱收件分析'}</h1><p className="mt-0.5 truncate text-xs text-muted-foreground">{sharing ? '邮箱收件分析' : 'DeepSeek · deepseek-flash'}</p></div></div>
          <div className="flex shrink-0 items-center gap-2">{sharing ? <><span className="hidden text-xs text-muted-foreground sm:block">仅在本机生成</span><Button variant="outline" disabled={!!busy} onClick={() => setSharing(false)}>取消</Button></> : <Button onClick={() => enterShare()}><Share2 />分享</Button>}</div>
        </header>
        {sharing ? <>
          <div className="flex shrink-0 border-b p-2 lg:hidden"><Button className="flex-1" variant={mobilePane === 'select' ? 'secondary' : 'ghost'} onClick={() => setMobilePane('select')}>选择消息 · {active.length}</Button><Button className="flex-1" variant={mobilePane === 'preview' ? 'secondary' : 'ghost'} onClick={() => setMobilePane('preview')}>图片预览</Button></div>
          <div className="flex min-h-0 flex-1">
            <section aria-label="选择消息" className={cn('flex min-h-0 w-full shrink-0 flex-col border-r lg:w-[360px] xl:w-[390px]', mobilePane !== 'select' && 'hidden lg:flex')}>
              <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-5"><h2 className="text-sm font-medium">选择消息 <span className="ml-1 text-muted-foreground">{active.length} / 6</span></h2><span className="text-xs text-muted-foreground">Shift 连选</span></div>
              <fieldset disabled={!!busy} className="flex shrink-0 gap-1 border-b px-3 py-2"><Button variant="ghost" onClick={() => preset(messages.map((m) => m.id))}>全选</Button><Button variant="ghost" onClick={() => preset([2, 4, 6])}>仅 AI</Button><Button variant="ghost" onClick={() => preset([5, 6])}>最近一轮</Button><Button variant="ghost" onClick={() => preset([])}>清空</Button></fieldset>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6" tabIndex={0} aria-label="可选择的对话消息">
                {[0, 1, 2].map((round) => <div key={round}>
                  <div className="flex items-center justify-between px-2 pt-4 pb-2"><span className="text-xs text-muted-foreground">第 {round + 1} 轮</span><Button variant="ghost" size="xs" disabled={!!busy} onClick={() => { const ids = [round * 2 + 1, round * 2 + 2]; const all = ids.every((id) => selected.has(id)); setSelected((previous) => { const next = new Set(previous); ids.forEach((id) => all ? next.delete(id) : next.add(id)); return next }) }}>{[round * 2 + 1, round * 2 + 2].every((id) => selected.has(id)) ? '取消本轮' : '选择本轮'}</Button></div>
                  {messages.slice(round * 2, round * 2 + 2).map((message) => <article key={message.id} data-message={message.id} className={cn('mb-2 rounded-lg border p-4 transition-colors', selected.has(message.id) ? 'border-primary/30 bg-muted/70' : 'border-border bg-background')}>
                    <div className="flex items-start gap-3"><Checkbox aria-label={`选择第 ${message.id} 条消息：${message.summary}`} checked={selected.has(message.id)} disabled={!!busy} onClick={(event) => { event.preventDefault(); choose(message.id, !selected.has(message.id), event.shiftKey) }} /><div className="min-w-0 flex-1"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium">{message.role === 'user' ? '我' : 'Synapse'}</span><time className="text-xs text-muted-foreground">{message.time}</time></div><div className="text-sm leading-7"><MessageBody id={message.id} /></div></div></div>
                  </article>)}
                </div>)}
              </div>
            </section>
            <section aria-label="图片预览及设置" className={cn('flex min-w-0 flex-1 flex-col', mobilePane !== 'preview' && 'hidden lg:flex')}>
              <div className="flex h-14 shrink-0 items-center justify-between border-b px-5"><div className="flex items-center gap-2"><Image className="size-4 text-muted-foreground" /><h2 className="text-sm font-medium">图片预览</h2></div><div className="flex gap-1"><Button variant="ghost" disabled={!active.length || !!busy} onClick={() => setFullSize((value) => !value)} aria-pressed={fullSize} className="tabular-nums">{fullSize ? '100% · 适应宽度' : `${Math.round(zoom * 100)}%`}</Button><Button variant="ghost" size="icon" aria-label="图片设置" aria-expanded={showSettings} onClick={() => setShowSettings((value) => !value)} className="xl:hidden"><SlidersHorizontal /></Button></div></div>
              <div className="flex min-h-0 flex-1">
                <div ref={viewport} className="min-h-0 min-w-0 flex-1 overflow-auto bg-surface p-5 sm:p-8" tabIndex={0} aria-label="可滚动的长图预览">
                  {active.length ? <div className="mx-auto" style={{ width: settings.width * zoom, height: paperHeight * zoom }}>
                    <div className="origin-top-left" style={{ width: settings.width, transform: `scale(${zoom})` }}>
                      <article ref={paper} id="share-paper" aria-label="待分享图片内容" className="overflow-hidden rounded-lg bg-background p-10 text-foreground" style={{ width: settings.width }}>
                        {settings.showTitle && <header className="mb-8 border-b pb-7"><p className="mb-3 text-sm text-muted-foreground">对话摘录</p><h2 className="break-words text-2xl leading-snug font-semibold">{settings.title.trim() || '对话摘录'}</h2>{settings.showTime && <p className="mt-3 text-sm text-muted-foreground">2026 年 10 月 24 日</p>}</header>}
                        <div className="space-y-8">{active.map((message, index) => <Fragment key={message.id}>
                          {index > 0 && message.id > active[index - 1].id + 1 && <div className="flex items-center gap-4 text-xs text-muted-foreground" data-omission><span className="h-px flex-1 bg-border" /><span>已省略内容</span><span className="h-px flex-1 bg-border" /></div>}
                          <section data-export-message={message.id}><div className="mb-3 flex items-center gap-2">{message.role === 'assistant' ? <Brand small /> : <span className="flex size-6 items-center justify-center rounded-md bg-muted text-xs font-medium">我</span>}<span className="text-sm font-medium">{message.role === 'assistant' ? 'Synapse' : '我'}</span>{settings.showModel && message.role === 'assistant' && <span className="ml-1 text-xs text-muted-foreground">DeepSeek</span>}{settings.showTime && <time className="ml-auto text-xs text-muted-foreground">{message.time}</time>}</div><div className={cn('text-lg leading-8 break-words', message.role === 'user' && 'rounded-lg bg-muted px-5 py-4')}><MessageBody id={message.id} redact={settings.redact} /></div></section>
                        </Fragment>)}</div>
                        {settings.showBrand && <footer className="mt-10 flex items-center justify-between border-t pt-5 text-xs text-muted-foreground"><span className="flex items-center gap-2"><Brand small /><span>Synapse</span></span><span>对话摘录</span></footer>}
                      </article>
                    </div>
                  </div> : <div className="flex h-full min-h-64 flex-col items-center justify-center text-center"><MessageSquare className="mb-4 size-8 text-muted-foreground" /><h3 className="font-medium">选择要分享的消息</h3><p className="mt-2 text-sm text-muted-foreground">可以只选一条，也可以组合多轮对话</p><Button className="mt-5" variant="outline" onClick={() => { preset([5, 6]); setMobilePane('select') }}>选择最近一轮</Button></div>}
                </div>
                <aside aria-label="图片设置" className={cn('w-60 shrink-0 overflow-y-auto border-l bg-background p-5', !showSettings && 'hidden xl:block', showSettings && 'w-52 sm:w-60')}>
                  <fieldset disabled={!!busy} className="space-y-6"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">图片设置</h2><Button variant="ghost" size="icon-xs" className="xl:hidden" aria-label="关闭图片设置" onClick={() => setShowSettings(false)}><X /></Button></div>
                    <Segment label="清晰度" value={settings.scale} options={[{value:2,label:'高清 2×'},{value:3,label:'超清 3×'}]} onChange={(value) => change('scale', value)} />
                    <Segment label="版式宽度" value={settings.width} options={[{value:720,label:'标准'},{value:960,label:'宽版'}]} onChange={(value) => change('width', value)} />
                    <div><Toggle label="显示标题" id="show-title" checked={settings.showTitle} onChange={(value) => change('showTitle', value)} />{settings.showTitle && <Input aria-label="分享图片标题" maxLength={60} className="mt-2" value={settings.title} onChange={(event) => change('title', event.target.value)} />}</div>
                    <div className="border-t pt-4"><Toggle label="隐藏邮箱" id="redact-email" checked={settings.redact} onChange={(value) => change('redact', value)} /><Toggle label="显示时间" id="show-time" checked={settings.showTime} onChange={(value) => change('showTime', value)} /><Toggle label="显示模型" id="show-model" checked={settings.showModel} onChange={(value) => change('showModel', value)} /><Toggle label="底部标识" id="show-brand" checked={settings.showBrand} onChange={(value) => change('showBrand', value)} /></div>
                    <div className="border-t pt-4 text-xs leading-6 text-muted-foreground"><p className="flex items-center gap-1.5"><ShieldCheck className="size-3.5" />PNG · 本机生成</p><p className="mt-1 tabular-nums" data-resolution>{active.length ? `${settings.width * settings.scale} × ${Math.round(paperHeight * settings.scale)} px` : '等待选择内容'}</p></div>
                  </fieldset>
                </aside>
              </div>
              <footer className="flex min-h-20 shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-background px-5 py-4"><div><p className="text-sm font-medium" aria-live="polite">已选择 {active.length} 条消息</p><p className="mt-1 text-xs text-muted-foreground">{settings.redact ? '邮箱已隐藏' : '包含邮箱地址'} · PNG · {settings.scale}×</p></div><div className="flex items-center gap-2"><Button variant="outline" disabled={!active.length || !!busy} onClick={() => void exportImage('copy')}>{busy === 'copy' ? <LoaderCircle className="animate-spin" /> : <Copy />}复制图片</Button><Button disabled={!active.length || !!busy} onClick={() => void exportImage('save')}>{busy === 'save' ? <LoaderCircle className="animate-spin" /> : <Download />}保存图片</Button></div></footer>
            </section>
          </div>
        </> : <div className="flex min-h-0 flex-1 flex-col"><div className="min-h-0 flex-1 overflow-y-auto px-5 py-8"><div className="mx-auto max-w-3xl space-y-10">{messages.map((message) => <section key={message.id} className={message.role === 'user' ? 'ml-auto max-w-xl' : ''}><div className="mb-3 flex items-center gap-2">{message.role === 'assistant' && <Brand small />}<span className="text-sm font-medium">{message.role === 'user' ? '我' : 'Synapse'}</span><time className="text-xs text-muted-foreground">{message.time}</time><Button variant="ghost" size="icon-xs" aria-label={`分享第 ${message.id} 条消息`} className="ml-auto" onClick={() => enterShare([message.id])}><Share2 /></Button></div><div className={cn('text-base leading-8', message.role === 'user' && 'rounded-xl bg-muted px-5 py-4')}><MessageBody id={message.id} /></div></section>)}</div></div><div className="shrink-0 px-5 pt-3 pb-5"><div className="mx-auto flex max-w-3xl items-center justify-between rounded-xl border bg-background px-4 py-3"><span className="text-sm text-muted-foreground">输入消息</span><Button variant="secondary" size="icon" disabled aria-label="原型不发送消息"><ArrowUp /></Button></div></div></div>}
      </main>
    </div>
    {notice && <div role={notice.error ? 'alert' : 'status'} className={cn('fixed right-5 bottom-5 z-50 flex max-w-[calc(100vw-40px)] items-start gap-3 rounded-lg border bg-popover p-4 text-sm text-popover-foreground', notice.error && 'border-destructive text-destructive')}>{notice.error ? <Info className="mt-0.5 size-4 shrink-0" /> : <Check className="mt-0.5 size-4 shrink-0" />}<span>{notice.text}</span><button aria-label="关闭提示" className="shrink-0 rounded focus-visible:ring-2" onClick={() => setNotice(null)}><X className="size-4" /></button></div>}
    <DesignNotes open={notes} onOpenChange={setNotes} />
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
