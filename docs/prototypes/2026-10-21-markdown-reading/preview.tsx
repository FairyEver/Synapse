import { useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BookOpen, Columns2, ExternalLink, FileText, PanelLeft, ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

const SOURCE_URL = 'https://synapse.d2.pub/share/shr_QX517XYDXZTVT7YWTQDDVWWZN6H3XK30'
const RESPONSIBILITIES = [
  ['场景策略管理', 'Portal → Mall OPS → ZHDJ 配置表', '产品配置：撤销/处理后消失还是提示，提示什么'],
  ['生命周期权威服务', 'SmartLayer', '保存当前业务状态与强制隐藏；公开检查/修改方法；统一约束与幂等'],
  ['本地业务适配', 'SmartLayer 评论等 Service', '源业务变更与公共状态调用同事务；生产通知时登记关联'],
  ['跨模块调用入口', 'Mall system-api', '其他模块只依赖 MessageLifecycleApi，调用方式接近普通本地服务'],
  ['跨系统可靠投递', 'Mall system-biz', '和业务同事务记录待发命令，提交后调用 SmartLayer；失败重试，不在业务各处复制网络代码'],
  ['展示查询与状态比对', 'SmartLayer → APP', '当前状态 + 源对象有效性 + 策略 + 用户/入口 → removedIds/changedMessages'],
]
const SCENARIOS = [
  ['普通二级评论回复通知', '二级回复；type 8/9/41', '可以；回复作者或管理员删除该回复', '否；阅读和再次回复都不视为处理', 'A：首个试点', '代码已确认，待规则签认'],
  ['原评论删除后的回复通知', '二级回复依赖一级评论', '可以；原评论单删/批删，或原评论不存在', '否', 'A：依赖兜底', '已查删除标记；提示口径待确认'],
  ['内容被删除后的评论通知', '回复依赖新闻/视频/专题等内容', '目标不可访问；原有删除字段作为路由兜底', '否', 'A：保留既有不可访问保护；不扩展所有内容删除埋点', '内容类型需按实际映射验证'],
  ['话题回复通知', '话题回复；type 20/50', '可以；用户删、管理员删、关联删、话题删', '否', 'B：第二个评论场景', '代码已确认，祖先依赖须专项验证'],
  ['新 CMS 评论', 'fm_content_comment 字符串 ID', '有删除能力', '未定义', '本次不接，待先确认通知生产链', '未确认有同一推送链'],
]
const OUTLINE = [
  ['architecture', '2.4 消息生命周期'],
  ['boundaries', '推荐边界'],
  ['flow', '架构流程图'],
  ['questions', '公共层的四个问题'],
  ['scenarios', '6. 业务场景矩阵'],
]

type WidthMode = 'reading' | 'wide'

function Prose({ children, mode, id }: { children: ReactNode; mode: WidthMode; id?: string }) {
  return <div id={id} data-prose className={cn('mx-auto w-full scroll-mt-24 space-y-4 text-base leading-7', mode === 'reading' && 'max-w-3xl')}>{children}</div>
}

function DocumentTable({ headings, rows, label, original }: { headings: string[]; rows: string[][]; label: string; original: boolean }) {
  return (
    <div data-breakout='table' className={cn('mx-auto w-full min-w-0', original && 'max-w-3xl')}>
      <div role='region' aria-label={label} tabIndex={0} className='overflow-x-auto rounded-md border border-border focus-visible:outline-2 focus-visible:outline-ring'>
        <Table className={cn('table-fixed text-base leading-6', headings.length > 3 ? 'min-w-6xl' : 'min-w-4xl')}>
          <TableHeader className='border-border bg-muted'>
            <TableRow className='border-border'>{headings.map((heading) => <TableHead key={heading} scope='col' className='px-4 py-3 font-semibold'>{heading}</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>{rows.map((cells) => <TableRow key={cells[0]} className='border-border'>{cells.map((cell, index) => <TableCell key={index} className='px-4 py-3 align-top whitespace-normal break-words'>{cell}</TableCell>)}</TableRow>)}</TableBody>
        </Table>
      </div>
    </div>
  )
}

// 按原文 Mermaid 的节点与连线绘制，原型仅静态呈现布局，不另接 Mermaid 运行时。
const NODES = [
  { id: 'portal', x: 24, y: 32, lines: ['Portal', '策略管理'] },
  { id: 'config', x: 260, y: 32, lines: ['场景配置'] },
  { id: 'mall', x: 24, y: 142, lines: ['Mall', '业务变更'] },
  { id: 'api', x: 240, y: 142, lines: ['system-api', '公共方法'] },
  { id: 'outbox', x: 456, y: 142, lines: ['本地事务', '待发命令'] },
  { id: 'gateway', x: 672, y: 142, lines: ['统一 Gateway'] },
  { id: 'smart', x: 24, y: 252, lines: ['SmartLayer', '业务变更'] },
  { id: 'core', x: 672, y: 252, lines: ['SmartLayer', '生命周期服务'] },
  { id: 'state', x: 888, y: 252, lines: ['权威状态', '关联 / 回执'] },
  { id: 'old', x: 24, y: 362, lines: ['历史消息', '与业务源表'] },
  { id: 'read', x: 1104, y: 252, lines: ['统一展示判断'] },
  { id: 'app', x: 1104, y: 362, lines: ['APP', '定时批量比对'] },
]
const EDGES = [
  'M204 64 H250',
  'M440 64 H1194 V242',
  'M204 174 H230',
  'M420 174 H446',
  'M636 174 H662',
  'M762 206 V242',
  'M204 284 H662',
  'M852 284 H878',
  'M1068 284 H1094',
  'M204 394 H1084 V306 H1094',
  'M1194 316 V352',
]

function ArchitectureDiagram({ original }: { original: boolean }) {
  return (
    <figure data-breakout='diagram' className={cn('mx-auto w-full min-w-0', original && 'max-w-3xl')}>
      <div role='region' aria-label='消息生命周期架构图，可横向滚动' tabIndex={0} className='overflow-x-auto rounded-md border border-border focus-visible:outline-2 focus-visible:outline-ring'>
        <svg viewBox='0 0 1310 458' role='img' aria-labelledby='diagram-title diagram-description' className='block h-auto w-full min-w-5xl font-sans'>
          <title id='diagram-title'>消息生命周期架构</title>
          <desc id='diagram-description'>Portal 管理场景配置。Mall 通过 system-api、本地事务待发命令和统一 Gateway 调用 SmartLayer 生命周期服务；SmartLayer 业务直接调用该服务。权威状态、场景配置和历史业务源表共同进入统一展示判断，再供 APP 定时批量比对。</desc>
          <defs><marker id='arrow' viewBox='0 0 10 10' refX='8' refY='5' markerWidth='6' markerHeight='6' orient='auto-start-reverse'><path d='M0 0 L10 5 L0 10Z' className='fill-muted-foreground' /></marker></defs>
          <g className='fill-none stroke-muted-foreground' strokeWidth='1.5' strokeLinejoin='round'>{EDGES.map((path) => <path key={path} d={path} markerEnd='url(#arrow)' />)}</g>
          <text x='774' y='232' className='fill-muted-foreground text-sm'>服务鉴权 API</text>
          {NODES.map((node) => <g key={node.id}>
            <rect x={node.x} y={node.y} width='180' height='64' rx='6' className='fill-muted stroke-border' />
            <text x={node.x + 90} y={node.y + (node.lines.length > 1 ? 25 : 38)} textAnchor='middle' className='fill-foreground text-base font-medium'>
              {node.lines.map((line, index) => <tspan key={line} x={node.x + 90} dy={index === 0 ? 0 : 23}>{line}</tspan>)}
            </text>
          </g>)}
        </svg>
      </div>
    </figure>
  )
}

function ReadingPrototype() {
  const [mode, setMode] = useState<WidthMode>('reading')
  const [compareOriginal, setCompareOriginal] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(true)
  const constrainMedia = mode === 'reading' && compareOriginal

  return (
    <div className='min-h-svh bg-background font-sans text-foreground'>
      <header className='sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-4 py-3 md:px-6'>
        <div className='flex min-w-0 flex-1 items-center gap-3'>
          <Button variant='ghost' size='icon' className='hidden lg:inline-flex' aria-label='切换目录' aria-expanded={outlineOpen} aria-controls='outline' onClick={() => setOutlineOpen(!outlineOpen)}><PanelLeft aria-hidden /></Button>
          <FileText className='size-5 shrink-0 text-muted-foreground' aria-hidden />
          <div className='min-w-0'>
            <div className='truncate text-sm font-medium'>评论回复消息失效：产品与现状评估</div>
            <div className='text-xs text-muted-foreground'>布局原型 · 原文节选</div>
          </div>
        </div>
        <div className='flex w-full flex-wrap items-center gap-1 sm:w-auto'>
          <Button variant={compareOriginal ? 'secondary' : 'ghost'} aria-pressed={compareOriginal} disabled={mode === 'wide'} onClick={() => setCompareOriginal(!compareOriginal)}><Columns2 aria-hidden />原版对比</Button>
          <div role='group' aria-label='阅读宽度' className='flex items-center gap-1'>
            <Button variant={mode === 'reading' ? 'secondary' : 'ghost'} aria-pressed={mode === 'reading'} onClick={() => setMode('reading')}><BookOpen aria-hidden />阅读</Button>
            <Button variant={mode === 'wide' ? 'secondary' : 'ghost'} aria-pressed={mode === 'wide'} onClick={() => setMode('wide')}><ScanLine aria-hidden />宽屏</Button>
          </div>
          <Button variant='ghost' size='icon' asChild><a href={SOURCE_URL} target='_blank' rel='noreferrer' aria-label='打开原文'><ExternalLink aria-hidden /></a></Button>
        </div>
      </header>

      <div className='flex min-w-0'>
        {outlineOpen && <aside id='outline' className='hidden w-56 shrink-0 border-r border-border lg:block'>
          <nav aria-label='文档目录' className='sticky top-24 space-y-2 p-4'>
            <p className='px-3 py-2 text-sm font-medium'>目录</p>
            {OUTLINE.map(([id, title]) => <Button key={id} variant='ghost' className='w-full justify-start' asChild><a href={`#${id}`}>{title}</a></Button>)}
          </nav>
        </aside>}

        <main id='document' data-mode={mode} data-original={constrainMedia} className='min-w-0 flex-1 px-4 pb-20 pt-10 md:px-6 md:pt-12'>
          <article className='space-y-8'>
            <Prose mode={mode}>
              <h1 className='text-3xl font-semibold leading-tight'>评论回复消息失效：<br className='sm:hidden' />产品与现状评估</h1>
              <p className='text-sm text-muted-foreground'>复核更新：2026-10-21 · v4</p>
            </Prose>
            <Prose id='architecture' mode={mode}>
              <h2 className='text-2xl font-semibold leading-snug'>2.4 将消息生命周期做成可复用能力</h2>
              <p><strong className='font-semibold'>SmartLayer 统一控制消息状态，并把检查、撤销、已处理、隐藏等能力公共化；本系统直接调 Service，Platform 和其他系统通过 API 调用。</strong>业务处只表达“哪个业务对象的哪次流程发生了什么变化”，不负责查通知、改字段、发 HTTP 或重试。</p>
              <h3 id='boundaries' className='scroll-mt-24 text-lg font-semibold'>推荐边界</h3>
            </Prose>
            <DocumentTable label='消息生命周期职责边界' headings={['层', '归属', '职责']} rows={RESPONSIBILITIES} original={constrainMedia} />
            <Prose mode={mode}>
              <p>这里“原子能力”有两层含义：一个方法只承担明确语义；同一数据库内的业务变更与消息命令一起提交。跨系统不伪装成分布式原子事务，而是使用本地待发记录保证最终送达。</p>
              <p>SmartLayer 内部不要通过 HTTP 调自己；Mall 不越过公共 API 直接修改 SmartLayer 状态表。配置通过现有 ZHDJ 数据源管理仍保留，不等于允许业务模块直接写消息状态。</p>
              <p>新增权威当前状态、消息业务关联、幂等回执；Mall 新增事务待发记录与版本计数。原通知正文继续保留，状态表不是第二份通知。历史评论缺少新关联/状态时，仍能从旧 messageId/messageId2 和 is_del 判断，不要求先迁移全量历史；页面轮询保持只读。</p>
              <h3 id='flow' className='scroll-mt-24 text-lg font-semibold'>架构流程图</h3>
            </Prose>
            <ArchitectureDiagram original={constrainMedia} />
            <Prose id='questions' mode={mode}>
              <h3 className='text-lg font-semibold'>四个需要在公共层解决的问题</h3>
              <ol className='list-decimal space-y-3 pl-6'>
                <li><strong className='font-semibold'>对象和周期。</strong>消息 ID 是通知主键；业务 ID 是回复/协议等对象；cycle 是本次流程。旧协议撤销不能误伤新一次审批通知。</li>
                <li><strong className='font-semibold'>接收人范围。</strong>ALL 是精确业务目标的全体接收人，USER 只影响指定人。一个人办理完成不能把其他人的消息一起变为已处理。普通已读仍独立。</li>
                <li><strong className='font-semibold'>隐藏与业务状态。</strong>revoke/markProcessed 改变业务状态；hide/clearHidden 改变业务强制隐藏。清除强制隐藏后仍受策略、父依赖、个人删除和入口范围限制，不等于强制显示。</li>
                <li><strong className='font-semibold'>可靠性。</strong>同操作重复调用不重复推进；旧版本不覆盖新版本；两个维度各有版本；命令先到、通知后生成仍能继承终态；远端超时保留待发记录。</li>
              </ol>
            </Prose>
            <Prose id='scenarios' mode={mode}>
              <h2 className='text-2xl font-semibold leading-snug'>6. 评论回复业务场景矩阵</h2>
              <p>以下“代码已确认”仅表示链路和状态来源已查到，不等于产品已批准。会议要求的浅绿色确认行，须在产品实际确认后再标注。</p>
            </Prose>
            <DocumentTable label='评论回复业务场景矩阵' headings={['场景', '关联对象', '能否失效 / 动作', '能否已处理 / 动作', '建议接入顺序', '状态']} rows={SCENARIOS} original={constrainMedia} />
            <Prose mode={mode}>
              <p>建议复用 UE portal.comment.delete 作为 A 场景编码；其含义是“评论回复通知因评论删除而失效”，不是再发送一条“评论删除通知”。B 如独立配置可新增 portal.topic.reply.delete，这是拟议编码，不是现有代码事实。</p>
            </Prose>
          </article>
        </main>
      </div>
      <div className='sr-only' role='status' aria-live='polite'>{mode === 'wide' ? '宽屏模式：正文与图表均使用可用宽度' : compareOriginal ? '原版阅读模式：正文与图表均限制在阅读宽度内' : '阅读模式：正文居中，表格和流程图展开'}</div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<ReadingPrototype />)
