import { Button, Checkbox, Label, SearchField, Skeleton } from '@heroui/react'
import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { HubTeamSelect } from './hub-team-select'
import { SkillUploadDialog } from './skill-upload-dialog'
import { HubPendingWrites } from './hub-pending-writes'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { SkillCatalogItem } from './skill-catalog-item'
import type { SkillHubSearch } from './skill-hub-navigation'
import { useSkillHubCatalog, useSkillHubSession, useSkillHubTeams } from './use-skill-hub'

type Props = { search: SkillHubSearch; onSearch: (search: SkillHubSearch) => void }

export function SkillHubCatalog(props: Props) {
  const session = useSkillHubSession()
  return <Catalog key={session} session={session} {...props} />
}

function Catalog({ session, search, onSearch }: Props & { session: string }) {
  const teams = useSkillHubTeams(session)
  const catalog = useSkillHubCatalog(session, { teamId: search.team, createdByMe: search.mine, query: search.q })
  const [uploadOpen, setUploadOpen] = useState(false)
  const [draft, setDraft] = useState(search.q ?? '')
  useEffect(() => { setDraft(search.q ?? '') }, [search.q])
  const skills = [...new Map(catalog.data?.pages.flatMap((page) => page.items.map((skill) => [skill.id, skill] as const))).values()]
  const noTeam = teams.data?.selectionState === 'none'
  const single = teams.data?.selectionState === 'single' ? teams.data.items[0] : undefined
  const error = teams.error ?? catalog.error
  const loading = teams.isPending || catalog.isPending
  function submitSearch(text: string) {
    onSearch({ ...search, q: text.trim() || undefined })
  }
  return <>
    <Header className="flex-wrap">
      <div className="min-w-0 flex-1 @lg/content:flex @lg/content:items-baseline @lg/content:gap-3">
        <h1 className="shrink-0">Skill Hub</h1>
        {single ? <p className="truncate text-sm text-muted" title={single.name}>{single.name}</p> : null}
      </div>
      <Button isDisabled={!teams.data || noTeam || !!teams.error} onPress={() => setUploadOpen(true)}><Plus aria-hidden="true" />上传 Skill</Button>
    </Header>
    <Main className="min-w-0 gap-5">
      <HubPendingWrites session={session} />
      <div className="flex min-w-0 flex-wrap items-end gap-x-4 gap-y-2">
        <div className="flex w-full min-w-0 items-center gap-2 @2xl/content:w-auto @2xl/content:max-w-md @2xl/content:flex-1">
          <SearchField className="min-w-0 flex-1" value={draft}
            onChange={(text) => { setDraft(text); if (!text && search.q) submitSearch(text) }}
            onSubmit={submitSearch}>
            <Label className="sr-only">搜索 Skill</Label>
            <SearchField.Group><SearchField.SearchIcon /><SearchField.Input maxLength={200} placeholder="搜索名称或介绍" /><SearchField.ClearButton /></SearchField.Group>
          </SearchField>
          <Button variant="secondary" onPress={() => submitSearch(draft)}>搜索</Button>
        </div>
        {teams.data?.selectionState === 'multiple' ? <div className="w-full min-w-0 @2xl/content:w-56">
          <HubTeamSelect all teams={teams.data.items} value={search.team} onChange={(team) => onSearch({ ...search, team })} />
        </div> : null}
        <Checkbox isSelected={Boolean(search.mine)} onChange={(selected) => onSearch({ ...search, mine: selected || undefined })}>
          <Checkbox.Content className="min-h-10"><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>我上传的</Checkbox.Content>
        </Checkbox>
      </div>
      {error ? <div role="alert" className="flex flex-wrap items-center gap-3">
        <p className="text-danger">{error.message || '暂时无法读取 Skill Hub。'}</p>
        <Button variant="secondary" onPress={() => { void teams.refetch(); void catalog.refetch() }}>重试</Button>
      </div> : loading ? <div role="status" aria-label="正在读取 Skill Hub" className="grid gap-5 @2xl/content:grid-cols-2">
        <Skeleton className="h-28 rounded-xl" /><Skeleton className="h-28 rounded-xl" />
      </div> : noTeam ? <p className="py-8 text-muted">你还没有加入任何团队。</p>
        : !skills.length ? <p className="py-8 text-muted">{search.q || search.mine || search.team ? '没有符合条件的 Skill。' : '团队还没有 Skill。'}</p>
          : <ul className="grid min-w-0 gap-x-8 @2xl/content:grid-cols-2 @6xl/content:grid-cols-3" aria-label="团队 Skill">
            {skills.map((skill) => <SkillCatalogItem key={skill.id} skill={skill} session={session} search={search} showTeam={!single} />)}
          </ul>}
      {!error && catalog.hasNextPage ? <Button variant="secondary" isPending={catalog.isFetchingNextPage}
        onPress={() => void catalog.fetchNextPage()}>加载更多</Button> : null}
    </Main>
    {uploadOpen ? <SkillUploadDialog session={session} teams={teams.data} onClose={() => setUploadOpen(false)} /> : null}
  </>
}
