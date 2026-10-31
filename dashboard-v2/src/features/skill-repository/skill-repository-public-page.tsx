import { consoleHref } from '@/lib/console-href';
import { Link as HeroLink } from '@heroui/react';
import { Button, Chip } from '@heroui/react';
import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Download, GitFork, Settings } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '@/lib/api';
import { skillRepositoryApi } from './skill-repository-api';
import { SkillRepositoryFileBrowser } from './skill-repository-file-browser';
import { getSkillRepositoryDisplayOwner } from './skill-repository-view-model';
import { usePublicSkillRepository } from './use-skill-repository';
import { useSkillRepositoryActions } from './use-skill-repository-actions';
export function SkillRepositoryPublicPage({ ownerHandle, repositoryName, }: {
    readonly ownerHandle: string;
    readonly repositoryName: string;
}) {
    const navigate = useNavigate();
    const repository = usePublicSkillRepository(ownerHandle, repositoryName);
    const detail = repository.detailQuery.data?.repository;
    const canonicalPath = repository.detailQuery.data?.canonicalPath;
    const actions = useSkillRepositoryActions(detail?.id ?? '');
    const meQuery = useQuery({ queryKey: ['dashboard-me'], queryFn: dashboardApi.getMe });
    useEffect(() => {
        if (!repository.detailQuery.data?.redirected || !canonicalPath)
            return;
        void navigate({
            to: '/skills/$ownerHandle/$repositoryName',
            params: {
                ownerHandle: canonicalPath.ownerHandle,
                repositoryName: canonicalPath.repositoryName,
            },
            replace: true,
        });
    }, [canonicalPath, navigate, repository.detailQuery.data?.redirected]);
    if (repository.detailQuery.isLoading) {
        return <div className='flex min-h-0 flex-1 items-center justify-center text-sm text-muted'>加载中</div>;
    }
    if (repository.detailQuery.isError || !detail || !repository.browser) {
        return (<div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm text-danger'>
        <div>{repository.detailQuery.error instanceof Error ? repository.detailQuery.error.message : '加载失败。'}</div>
        <Button type='button' variant="outline" onPress={() => { void repository.detailQuery.refetch(); }}>重试</Button>
      </div>);
    }
    const owner = getSkillRepositoryDisplayOwner(detail);
    const isOwner = meQuery.data?.user.id === detail.owner.id;
    return (<div className='flex min-h-0 flex-1 flex-col gap-4 p-6'>
      <div className='flex shrink-0 flex-col gap-3 md:flex-row md:items-center md:justify-between'>
        <div className='flex min-w-0 items-center gap-2'>
          <h1 className='min-w-0 truncate text-xl font-semibold'>
            <span className='text-muted'>{owner}</span>
            <span className='px-1 text-muted'>/</span>
            <span>{detail.name}</span>
          </h1>
          <Chip variant="secondary">{formatVisibility(detail.visibility)}</Chip>
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          <Button type='button' variant="outline" isDisabled={actions.states.installing || !detail.id} onPress={() => { void actions.createInstallSession(); }}>
            <Download data-icon='inline-start'/>
            安装
          </Button>
          <Button type='button' variant="outline" isDisabled={actions.states.forking || !detail.id} onPress={() => { void actions.forkRepository({}); }}>
            <GitFork data-icon='inline-start'/>
            Fork
          </Button>
          {isOwner ? (<HeroLink href={consoleHref('/skill-repositories/$repositoryId', { params: { repositoryId: detail.id } })}>
                <Settings data-icon='inline-start'/>
                设置
              </HeroLink>) : null}
        </div>
      </div>

      <SkillRepositoryFileBrowser readonlyMode tree={repository.browser.tree} selectedFilePath={repository.selectedFilePath} fileContent={repository.fileContentQuery.data ?? null} fileLoading={repository.fileContentQuery.isFetching} savingText={false} reloadingFile={repository.fileContentQuery.isFetching} onNavigateFolder={(path) => {
            repository.setSelectedFilePath(null);
            repository.setCurrentPath(path);
        }} onOpenFile={repository.setSelectedFilePath} onRenameFile={async () => undefined} onDeleteFile={async () => undefined} onDownloadFile={(path) => skillRepositoryApi.getFileDownloadUrlByPath(ownerHandle, repositoryName, path)} onReloadText={async () => ({ text: repository.fileContentQuery.data?.text ?? '', baseVersionId: repository.fileContentQuery.data?.file.sha256 ?? '' })} onSaveText={async (input) => ({ baseVersionId: input.baseVersionId })}/>
    </div>);
}
function formatVisibility(value: 'private' | 'public'): string {
    return value === 'public' ? '公开' : '私有';
}
