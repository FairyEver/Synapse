import { Header } from '@/components/layout/header';
import { Main } from '@/components/layout/main';
import { Button, Chip, Input, Table } from '@heroui/react';
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Download, GitFork, Search } from 'lucide-react';
import { RelativeTime } from '@/components/relative-time';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import type { SkillRepositoryItemDto } from '@synapse/shared';
import { usePublicSkillRepositoryList } from './use-skill-repository';
import { useSkillRepositoryActions } from './use-skill-repository-actions';
import { getSkillRepositoryDisplayOwner } from './skill-repository-view-model';
export function SkillRepositoryExplorePage() {
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const debouncedQuery = useDebouncedValue(query);
    const listQuery = usePublicSkillRepositoryList({ page: 1, pageSize: 20, query: debouncedQuery.trim() || null });
    const repositories = listQuery.data?.items ?? [];
    return (<><Header><h1>探索 Skills</h1></Header><Main>
      <div className='flex flex-wrap items-center justify-end gap-3'>

        <div className='relative w-full md:w-72'>
          <Search className='pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted'/>
          <Input value={query} onChange={(event) => setQuery(event.target.value)} className='pl-8' placeholder='搜索 Skill'></Input>
        </div>
      </div>

      <div className='min-w-0'>
        {listQuery.isLoading ? (<div className='flex min-h-60 items-center justify-center rounded-2xl bg-surface p-6 text-sm text-muted'>加载中</div>) : listQuery.isError ? (<div className='flex min-h-60 flex-col items-center justify-center gap-3 rounded-2xl bg-surface p-6 text-sm text-danger'>
            <div>{listQuery.error instanceof Error ? listQuery.error.message : '加载失败。'}</div>
            <Button type='button' variant="outline" onPress={() => { void listQuery.refetch(); }}>重试</Button>
          </div>) : repositories.length === 0 ? (<div className='flex min-h-60 items-center justify-center rounded-2xl bg-surface p-6 text-sm text-muted'>暂无公开 Skill</div>) : (<Table><Table.ScrollContainer><Table.Content className='min-w-max'>
            <Table.Header>

                <Table.Column isRowHeader>仓库</Table.Column>
                <Table.Column>标题</Table.Column>
                <Table.Column className='w-28'>可见性</Table.Column>
                <Table.Column className='w-40'>更新时间</Table.Column>
                <Table.Column className='w-36 text-right'>操作</Table.Column>

            </Table.Header>
            <Table.Body>
              {repositories.map((repository) => (<Table.Row key={repository.id} className='cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset' onAction={() => {
                    void navigate({
                        to: '/skills/$ownerHandle/$repositoryName',
                        params: {
                            ownerHandle: repository.owner.handle ?? getSkillRepositoryDisplayOwner({ ...repository, files: [] }),
                            repositoryName: repository.name,
                        },
                    });
                }}>
                  <Table.Cell className='font-medium'>
                    <RepositoryLink repository={repository}/>
                  </Table.Cell>
                  <Table.Cell className='text-muted'>{repository.title}</Table.Cell>
                  <Table.Cell>
                    <Chip variant="secondary">{formatVisibility(repository.visibility)}</Chip>
                  </Table.Cell>
                  <Table.Cell className='text-muted'>
                    <RelativeTime value={repository.updatedAt}/>
                  </Table.Cell>
                  <Table.Cell className='text-right'>
                    <RepositoryActions repository={repository}/>
                  </Table.Cell>
                </Table.Row>))}
            </Table.Body>
          </Table.Content></Table.ScrollContainer></Table>)}
      </div>
    </Main></>);
}
function RepositoryLink({ repository }: {
    readonly repository: SkillRepositoryItemDto;
}) {
    const owner = getSkillRepositoryDisplayOwner({ ...repository, files: [] });
    return (<span>
      <span className='text-muted'>{owner}</span>
      <span className='px-1 text-muted'>/</span>
      <span>{repository.name}</span>
    </span>);
}
function RepositoryActions({ repository }: {
    readonly repository: SkillRepositoryItemDto;
}) {
    const actions = useSkillRepositoryActions(repository.id);
    return (<div className='flex justify-end gap-2'>
      <Button type='button' variant="ghost" isIconOnly aria-label='安装' isDisabled={actions.states.installing} onPress={() => { void actions.createInstallSession(); }}>
        <Download className='size-4'/>
      </Button>
      <Button type='button' variant="ghost" isIconOnly aria-label='Fork' isDisabled={actions.states.forking} onPress={() => { void actions.forkRepository({}); }}>
        <GitFork className='size-4'/>
      </Button>
    </div>);
}
function formatVisibility(value: 'private' | 'public'): string {
    return value === 'public' ? '公开' : '私有';
}
