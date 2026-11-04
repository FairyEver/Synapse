import { Button, Skeleton, Tabs } from '@heroui/react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, File, PackageOpen } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { SkillHubDetail } from '@synapse/shared/skill-hub-contracts'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { SkillHubIcon, SkillInstallButton } from './skill-catalog-item'
import { skillHubApi } from './skill-hub-api'
import type { SkillHubSearch } from './skill-hub-navigation'
import { SkillMaintenance } from "./skill-maintenance"
import { SkillMainView } from './skill-main-view'
import { useSkillHubDetail, useSkillHubMain, useSkillHubSession } from './use-skill-hub'

const publishedDate = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" })

export function SkillHubDetailPage({ skillId, search }: { skillId: string; search: SkillHubSearch }) {
  const session = useSkillHubSession()
  const detail = useSkillHubDetail(session, skillId)
  const navigate = useNavigate()
  return <>
    <Header fixed={false}>
      <Link to="/skill-hub/" search={search} className="inline-flex items-center gap-2 rounded-sm text-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-accent">
        <ArrowLeft className="size-4" aria-hidden="true" />Skill Hub
      </Link>
    </Header>
    <Main className="max-w-5xl min-w-0">
      {detail.isError ? <div role="alert" className="flex flex-wrap items-center gap-3">
        <p className="text-danger">{detail.error.message || '该 Skill 不可用。'}</p>
        <Button variant="secondary" onPress={() => void detail.refetch()}>重试</Button>
      </div> : detail.data ? <SkillDetail key={`${session}:${skillId}`} skill={detail.data} session={session}
        reload={() => { void detail.refetch() }} onDeleted={() => void navigate({ to: "/skill-hub/", search })} /> : <Skeleton role="status" aria-label="正在读取 Skill" className="h-40 rounded-xl" />}
    </Main>
  </>
}

export function SkillDetail({ skill, session, reload, onDeleted = reload }: { skill: SkillHubDetail; session: string; reload: () => void; onDeleted?: () => void }) {
  const [tab, setTab] = useState('main')
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => active.current?.abort(), [])
  const version = skill.currentVersion
  const main = useSkillHubMain(session, skill.id, version.id, tab === 'main')
  async function download() {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setDownloading(true)
    setError('')
    try {
      const blob = await skillHubApi.download(session, skill.id, version.id, controller.signal)
      if (controller.signal.aborted) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${skill.package.name}.zip`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '下载失败，请重试。')
    } finally {
      active.current = null
      if (!controller.signal.aborted) setDownloading(false)
    }
  }

  return <div className="grid min-w-0 gap-6">
    <div className="grid min-w-0 gap-4 border-b border-separator pb-6">
      <div className="flex min-w-0 items-start gap-4">
        <SkillHubIcon skill={skill} session={session} large />
        <div className="min-w-0 space-y-1">
          <p className="wrap-anywhere text-sm font-medium text-muted">{skill.team.name} · v{version.number} · <time dateTime={skill.publishedAt}>{publishedDate.format(new Date(skill.publishedAt))}</time></p>
          <h1 className="wrap-anywhere text-2xl leading-tight font-semibold sm:text-3xl">{skill.displayName}</h1>
          <p className="wrap-anywhere whitespace-pre-wrap text-sm leading-relaxed text-muted">{skill.displayDescription}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2"><SkillInstallButton id={skill.id} variant="primary" />
        <Button variant="secondary" isPending={downloading} onPress={() => void download()}><PackageOpen aria-hidden="true" />下载 ZIP</Button>
        <SkillMaintenance skill={skill} session={session} onDeleted={onDeleted} />
      </div>
      {error ? <p role="alert" className="text-danger">{error}</p> : null}
      <dl className="grid min-w-0 gap-x-6 gap-y-3 text-sm @lg/content:grid-cols-2">
        <div><dt className="text-muted">包内名称</dt><dd className="wrap-anywhere font-mono">{skill.package.name}</dd></div>
        <div><dt className="text-muted">包内介绍</dt><dd className="wrap-anywhere whitespace-pre-wrap">{skill.package.description}</dd></div>
        <div><dt className="text-muted">贡献者</dt><dd className="wrap-anywhere">{skill.createdBy.displayName}</dd></div>
        <div><dt className="text-muted">维护者</dt><dd className="wrap-anywhere">{skill.maintainer.displayName}{skill.maintainer.isActiveMember ? '' : '（已离队或停用）'}</dd></div>
      </dl>
    </div>
    <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
      <Tabs.ListContainer><Tabs.List aria-label="Skill 包">
        <Tabs.Tab id="main">说明<Tabs.Indicator /></Tabs.Tab><Tabs.Tab id="files">文件<Tabs.Indicator /></Tabs.Tab>
      </Tabs.List></Tabs.ListContainer>
      <Tabs.Panel id="main" className="min-w-0 pt-4">
        {main.isError ? <div role="alert" className="flex flex-wrap items-center gap-3"><p className="text-danger">{main.error.message}</p>
          <Button variant="secondary" onPress={() => { reload(); void main.refetch() }}>重新读取</Button></div>
          : main.data ? <SkillMainView content={main.data.content} /> : <Skeleton aria-label="正在读取说明" role="status" className="h-24 rounded-lg" />}
      </Tabs.Panel>
      <Tabs.Panel id="files" className="min-w-0 pt-4">
        <ul className="divide-y divide-separator">{skill.files.map((file) => <li key={file.path} className="flex min-w-0 items-center gap-2 py-3 text-sm">
          <File className="size-4 shrink-0 text-muted" aria-hidden="true" /><span className="min-w-0 flex-1 wrap-anywhere font-mono">{file.path}</span>
          <span className="shrink-0 text-muted tabular-nums">{file.size.toLocaleString()} B</span>
        </li>)}</ul>
      </Tabs.Panel>
    </Tabs>
  </div>
}
