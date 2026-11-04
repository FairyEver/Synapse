import { Button, toast } from '@heroui/react'
import { ArrowUpRight, Package } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { SkillHubSummary } from '@synapse/shared/skill-hub-contracts'
import { skillHubApi } from './skill-hub-api'
import { openSkillInSynapse, type SkillHubSearch } from './skill-hub-navigation'

function SkillImage({ session, id, revision }: { session: string; id: string; revision: number }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | undefined
    void skillHubApi.icon(session, id, controller.signal).then((blob) => {
      if (controller.signal.aborted) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }).catch(() => { if (!controller.signal.aborted) setUrl('') })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [session, id, revision])
  return url ? <img alt="" className="size-full object-cover" src={url} /> : <Package aria-hidden="true" className="size-1/2" />
}

export function SkillHubIcon({ session, skill, large = false }: {
  session: string; skill: Pick<SkillHubSummary, 'id' | 'iconUrl' | 'revision'>; large?: boolean
}) {
  return <div aria-hidden="true" className={`grid shrink-0 place-items-center overflow-hidden bg-surface-secondary text-muted ${large ? 'size-13 rounded-xl sm:size-17' : 'size-9 rounded-lg @2xl/content:size-10'}`}>
    {skill.iconUrl ? <SkillImage key={`${session}:${skill.id}:${skill.revision}`} session={session} id={skill.id} revision={skill.revision} />
      : <Package className="size-1/2" />}
  </div>
}

export function SkillInstallButton({ id, variant = 'secondary', catalogName }: {
  id: string; variant?: 'primary' | 'secondary'; catalogName?: string
}) {
  function install() {
    try { toast.info(openSkillInSynapse(id)) }
    catch { toast.danger('无法打开 Synapse，请重试。') }
  }
  return <Button variant={catalogName ? 'ghost' : variant} onPress={install}
    aria-label={catalogName ? `安装 ${catalogName} 到 Synapse` : '安装到 Synapse'}>
    {catalogName ? '安装' : <><ArrowUpRight aria-hidden="true" /><span className="hidden min-[371px]:inline">安装到 Synapse</span><span className="min-[371px]:hidden">安装</span></>}
  </Button>
}

export function SkillCatalogItem({ skill, search, session, showTeam }: {
  skill: SkillHubSummary; search: SkillHubSearch; session: string; showTeam: boolean
}) {
  return <li className="relative grid min-w-0 items-center gap-4 py-3 @2xl/content:grid-cols-[minmax(0,1fr)_auto]">
    <Link to="/skill-hub/$skillId" params={{ skillId: skill.id }} search={search} aria-labelledby={`skill-title-${skill.id}`}
      className="group grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1 rounded-sm focus-visible:outline-2 focus-visible:outline-accent @2xl/content:grid-cols-[auto_minmax(0,1fr)_minmax(6rem,13%)] @2xl/content:items-center @2xl/content:gap-x-3">
      <SkillHubIcon session={session} skill={skill} />
      <div className="min-w-0">
        <h2 id={`skill-title-${skill.id}`} title={skill.displayName}
          className="truncate text-sm font-semibold group-hover:text-accent-soft-foreground group-hover:underline">{skill.displayName}</h2>
        <p className="mt-0.5 line-clamp-2 max-w-prose wrap-anywhere text-sm leading-5 text-muted">{skill.displayDescription}</p>
      </div>
      <div className="col-start-2 flex min-w-0 items-center gap-1.5 pe-16 text-xs text-muted @2xl/content:col-start-3 @2xl/content:pe-0">
        {showTeam ? <>
          <span className="min-w-0 truncate" title={skill.team.name}>{skill.team.name}</span>
          <span aria-hidden="true">·</span>
        </> : null}
        <span className="shrink-0 tabular-nums">v{skill.currentVersion.number}</span>
      </div>
    </Link>
    <div className="absolute end-0 bottom-0.5 @2xl/content:static">
      <SkillInstallButton id={skill.id} catalogName={skill.displayName} />
    </div>
  </li>
}
