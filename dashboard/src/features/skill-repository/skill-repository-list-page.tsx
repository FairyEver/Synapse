import { Header } from '@/components/layout/header';
import { Main } from '@/components/layout/main';
import { Button, Chip, Modal, Table } from '@heroui/react';
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Plus, RefreshCw } from 'lucide-react';
import { RelativeTime } from '@/components/relative-time';
import { useSkillRepositoryList } from './use-skill-repository';
export function SkillRepositoryListPage() {
    const navigate = useNavigate();
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const query = useSkillRepositoryList();
    const repositories = query.data ?? [];
    return (<><Header><h1>我的 Skill 仓库</h1></Header><Main>
      <div className='flex flex-wrap items-center justify-end gap-3'>

        <div className='flex items-center gap-2'>
          <Button type='button' onPress={() => setCreateDialogOpen(true)}>
            <Plus data-icon='inline-start'/>
            新建
          </Button>
          <Button type='button' variant="outline" onPress={() => { void query.refetch(); }}>
            <RefreshCw data-icon='inline-start' className={query.isFetching ? 'animate-spin' : undefined}/>
            刷新
          </Button>
        </div>
      </div>

      <Modal.Backdrop isOpen={createDialogOpen} onOpenChange={setCreateDialogOpen}><Modal.Container><Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>网页端暂未提供新建入口</Modal.Heading>
            <p>
              当前页面仅支持查看和管理已有 Skill 仓库。请在 Synapse 客户端从本地 Skill 上传或导入仓库，完成后刷新本页查看。
            </p>
          </Modal.Header>
          <Modal.Footer>
            <Button type='button' slot="close">关闭</Button>
          </Modal.Footer>
        </Modal.Dialog></Modal.Container></Modal.Backdrop>

      <div className='min-w-0'>
        {query.isLoading ? (<div className='flex min-h-60 items-center justify-center rounded-2xl bg-surface p-6 text-sm text-muted'>加载中</div>) : query.isError ? (<div className='flex min-h-60 flex-col items-center justify-center gap-3 rounded-2xl bg-surface p-6 text-sm text-danger'>
            <div>{query.error instanceof Error ? query.error.message : '加载失败。'}</div>
            <Button type='button' variant="outline" onPress={() => { void query.refetch(); }}>重试</Button>
          </div>) : repositories.length === 0 ? (<div className='flex min-h-60 flex-col items-center justify-center gap-1 rounded-2xl bg-surface p-6 text-center text-sm text-muted'>
            <div>暂无 Skill 仓库</div>
            <div>通过本地 Synapse MCP 上传 Skill 后会显示在这里。</div>
          </div>) : (<Table><Table.ScrollContainer><Table.Content className='min-w-max'>
            <Table.Header>

                <Table.Column isRowHeader>仓库</Table.Column>
                <Table.Column>标题</Table.Column>
                <Table.Column className='w-24 text-right'>文件</Table.Column>
                <Table.Column className='w-28'>可见性</Table.Column>
                <Table.Column className='w-40'>更新时间</Table.Column>

            </Table.Header>
            <Table.Body>
              {repositories.map((repository) => (<Table.Row key={repository.id} className='cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset' onAction={() => {
                    void navigate({
                        to: '/skill-repositories/$repositoryId',
                        params: { repositoryId: repository.id },
                    });
                }}>
                  <Table.Cell className='font-medium'>
                    {repository.name}
                  </Table.Cell>
                  <Table.Cell className='text-muted'>{repository.title}</Table.Cell>
                  <Table.Cell className='text-right text-muted'>-</Table.Cell>
                  <Table.Cell>
                    <Chip variant="secondary">{formatVisibility(repository.visibility)}</Chip>
                  </Table.Cell>
                  <Table.Cell className='text-muted'>
                    <RelativeTime value={repository.updatedAt}/>
                  </Table.Cell>
                </Table.Row>))}
            </Table.Body>
          </Table.Content></Table.ScrollContainer></Table>)}
      </div>
    </Main></>);
}
function formatVisibility(value: 'private' | 'public'): string {
    return value === 'public' ? '公开' : '私有';
}
