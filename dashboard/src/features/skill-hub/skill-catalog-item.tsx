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
  return <div aria-hidden="true" className={`grid shrink-0 place-items-center overflow-hidden bg-surface-secondary text-muted ${large ? 'size-13 rounded-xl sm:size-17' : 'size-8 rounded-lg'}`}>
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
  return <li className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3">
    <Link to="/skill-hub/$skillId" params={{ skillId: skill.id }} search={search} aria-labelledby={`skill-title-${skill.id}`}
      className="group grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 rounded-sm focus-visible:outline-2 focus-visible:outline-accent">
      <SkillHubIcon session={session} skill={skill} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 id={`skill-title-${skill.id}`} title={skill.displayName}
            className="min-w-0 truncate text-sm font-semibold group-hover:text-accent-soft-foreground group-hover:underline">{skill.displayName}</h2>
          <span className="shrink-0 text-xs text-muted tabular-nums">v{skill.currentVersion.number}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 wrap-anywhere text-sm leading-5 text-muted">{skill.displayDescription}</p>
        {showTeam ? <p className="mt-1 truncate text-xs text-muted" title={skill.team.name}>{skill.team.name}</p> : null}
      </div>
    </Link>
    <div>
      <SkillInstallButton id={skill.id} catalogName={skill.displayName} />
    </div>
  </li>
}
