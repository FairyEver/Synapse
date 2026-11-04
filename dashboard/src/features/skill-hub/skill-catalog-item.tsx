import { Button, toast } from '@heroui/react'
import { Download, Package } from 'lucide-react'
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
  return url ? <img alt="" className="size-full object-cover" src={url} /> : <Package aria-hidden="true" className="size-6" />
}

export function SkillHubIcon({ session, skill, large = false }: {
  session: string; skill: Pick<SkillHubSummary, 'id' | 'iconUrl' | 'revision'>; large?: boolean
}) {
  return <div aria-hidden="true" className={`grid shrink-0 place-items-center overflow-hidden bg-surface-secondary text-muted ${large ? 'size-16 rounded-xl sm:size-20' : 'size-10 rounded-lg'}`}>
    {skill.iconUrl ? <SkillImage key={`${session}:${skill.id}:${skill.revision}`} session={session} id={skill.id} revision={skill.revision} />
      : <Package className={large ? 'size-8' : 'size-6'} />}
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
    aria-label={catalogName ? `安装 ${catalogName} 到 Synapse` : undefined}>
    {catalogName ? '安装' : <><Download aria-hidden="true" />安装到 Synapse</>}
  </Button>
}

export function SkillCatalogItem({ skill, search, session, showTeam }: {
  skill: SkillHubSummary; search: SkillHubSearch; session: string; showTeam: boolean
}) {
  return <li className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 border-t border-separator py-4">
    <SkillHubIcon session={session} skill={skill} />
    <div className="flex min-w-0 flex-col">
      <h2 className="text-base font-semibold">
        <Link to="/skill-hub/$skillId" params={{ skillId: skill.id }} search={search}
          title={skill.displayName} className="block truncate rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-accent">{skill.displayName}</Link>
      </h2>
      <p className="mt-1 line-clamp-2 wrap-anywhere text-sm leading-5 text-muted">{skill.displayDescription}</p>
      <div className="mt-auto flex min-w-0 items-center justify-between gap-2 pt-1">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
          {showTeam ? <span className="min-w-0 truncate" title={skill.team.name}>{skill.team.name}</span> : null}
          <span className="shrink-0 tabular-nums">v{skill.currentVersion.number}</span>
        </div>
        <SkillInstallButton id={skill.id} catalogName={skill.displayName} />
      </div>
    </div>
  </li>
}
