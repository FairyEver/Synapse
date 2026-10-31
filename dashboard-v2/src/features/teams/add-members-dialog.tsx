import { Button, Checkbox, Input, Modal, toast } from '@heroui/react';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi, type AdminTeamCandidateRow } from '@/lib/api';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
const candidatePageSize = 50;
type AddMembersDialogProps = {
    open: boolean;
    teamId: string;
    organizationId?: string;
    onOpenChange: (open: boolean) => void;
};
export function AddMembersDialog({ open, teamId, organizationId, onOpenChange, }: AddMembersDialogProps) {
    const queryClient = useQueryClient();
    const [query, setQuery] = useState('');
    const debouncedQuery = useDebouncedValue(query);
    const [page, setPage] = useState(1);
    const [candidates, setCandidates] = useState<AdminTeamCandidateRow[]>([]);
    const [total, setTotal] = useState(0);
    // 勾选是本地状态：搜索或换页之后已选的人不能丢，所以不在查询结果里找它。
    const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
    useEffect(() => {
        if (open)
            return;
        setQuery('');
        setPage(1);
        setCandidates([]);
        setTotal(0);
        setPicked(new Set());
    }, [open]);
    const candidatesQuery = useQuery({
        queryKey: ['admin-team-candidates', teamId, organizationId, debouncedQuery.trim(), page],
        queryFn: () => (organizationId ? adminApi.listOrganizationCandidates(teamId, organizationId, {
            page,
            pageSize: candidatePageSize,
            query: debouncedQuery.trim() || undefined,
        }) : adminApi.listTeamMemberCandidates(teamId, {
            page,
            pageSize: candidatePageSize,
            query: debouncedQuery.trim() || undefined,
        })),
        enabled: open,
    });
    const candidateRows = candidatesQuery.data?.data;
    useEffect(() => {
        if (!candidateRows)
            return;
        setTotal(candidatesQuery.data?.total ?? 0);
        setCandidates((current) => {
            if (page === 1)
                return candidateRows;
            const known = new Set(current.map((candidate) => candidate.id));
            return [
                ...current,
                ...candidateRows.filter((candidate) => !known.has(candidate.id)),
            ];
        });
    }, [candidateRows, candidatesQuery.data?.total, page]);
    const addMembers = useMutation({
        mutationFn: (userIds: string[]) => organizationId ? adminApi.addOrganizationMembers(teamId, organizationId, userIds) : adminApi.addTeamMembers(teamId, userIds),
        onSuccess: (result) => {
            if (organizationId) {
                void queryClient.invalidateQueries({ queryKey: ['admin-organizations', teamId] });
                void queryClient.invalidateQueries({ queryKey: ['admin-organization-members', teamId, organizationId] });
            }
            void queryClient.invalidateQueries({ queryKey: ['admin-team-members', teamId] });
            void queryClient.invalidateQueries({ queryKey: ['admin-teams'] });
            void queryClient.invalidateQueries({ queryKey: ['admin-team', teamId] });
            void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
            toast.success(`已添加 ${result.added} 名成员`);
            onOpenChange(false);
        },
        onError: (error: Error) => toast.danger(error.message),
    });
    function toggle(id: string, checked: boolean) {
        setPicked((current) => {
            const next = new Set(current);
            if (checked)
                next.add(id);
            else
                next.delete(id);
            return next;
        });
    }
    return (<Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container><Modal.Dialog className='sm:max-w-lg'><Modal.CloseTrigger />
        <Modal.Header>
          <Modal.Heading>添加成员</Modal.Heading>
          <p className='sr-only'>添加团队成员。</p>
        </Modal.Header><Modal.Body>
        <div className='grid gap-3'>
          <Input value={query} placeholder='搜索邮箱或用户名' autoComplete='off' aria-label='搜索邮箱或用户名' onChange={(event) => {
            setQuery(event.target.value);
            // 换搜索词必须回到第一页，否则会先按旧页码去查新词。
            setPage(1);
        }}/>
          <div className='max-h-72 overflow-y-auto rounded-md border'>
            {candidates.length === 0 ? (<p className='px-3 py-6 text-center text-sm text-muted'>
                {candidatesQuery.isLoading ? '加载中…' : '没有可以添加的用户'}
              </p>) : (<div className='flex flex-col py-1'>
                {candidates.map((candidate) => (<div key={candidate.id} className='flex items-center gap-2 px-3 py-1.5'>
                    <Checkbox className='min-w-0 flex-1' isSelected={picked.has(candidate.id)} onChange={(checked) => toggle(candidate.id, checked)}>
                      <Checkbox.Content className='w-full min-w-0'>
                        <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                        <span className='min-w-0 flex-1'>
                          <span className='block truncate'>{candidate.email}</span>
                          <span className='block truncate text-xs text-muted'>
                            {candidate.handle}{candidate.status === 'disabled' ? ' · 已禁用' : ''}
                          </span>
                        </span>
                      </Checkbox.Content>
                    </Checkbox>
                  </div>))}
              </div>)}
          </div>
          {candidates.length < total ? (<Button variant='outline' size='sm' isDisabled={candidatesQuery.isFetching} onPress={() => setPage((current) => current + 1)}>
              加载更多
            </Button>) : null}
        </div>
        </Modal.Body><Modal.Footer>
          <span className='me-auto text-sm text-muted'>
            已选 {picked.size} 人
          </span>
          <Button variant='outline' onPress={() => onOpenChange(false)}>
            取消
          </Button>
          <Button isDisabled={picked.size === 0 || addMembers.isPending} onPress={() => addMembers.mutate([...picked])}>
            添加
          </Button>
        </Modal.Footer>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>);
}
