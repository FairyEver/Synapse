import { TextField } from '@heroui/react';
import { Button, Input, Label, Link, Modal, toast } from '@heroui/react';
import { useMemo, useState, type FormEvent, } from 'react';
import type { DashboardWebhookDto } from '@synapse/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { dashboardApi } from '@/lib/api';
import { consoleHref } from '@/lib/console-href';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DEFAULT_DASHBOARD_PAGE_SIZE, ServerDataTable, } from '@/components/data-table';
import { Header } from '@/components/layout/header';
import { Main } from '@/components/layout/main';
import { getWebhookErrorMessage } from './webhook-error';
import { WebhookUrlDialog } from './webhook-url-dialog';
import { getWebhookResetSecretDialogDescription, webhookResetSecretDialogTitle, } from './webhook-reset-secret';
import { buildWebhookColumns } from './webhook-columns';
export type WebhookFormState = {
    mode: 'create' | 'edit';
    webhook: DashboardWebhookDto | null;
    name: string;
};
type OneTimeUrlState = {
    title: string;
    url: string;
};
export default function WebhooksPage({ createOnOpen = false }: { createOnOpen?: boolean }) {
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE);
    const [form, setForm] = useState<WebhookFormState | null>(() => createOnOpen
        ? { mode: 'create', webhook: null, name: '' }
        : null);
    const [oneTimeUrl, setOneTimeUrl] = useState<OneTimeUrlState | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<DashboardWebhookDto | null>(null);
    const [resetSecretTarget, setResetSecretTarget] = useState<DashboardWebhookDto | null>(null);
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const webhooksQuery = useQuery({
        queryKey: ['dashboard-webhooks', page, pageSize],
        queryFn: () => dashboardApi.listWebhooks({ page, pageSize }),
    });
    const webhooksPage = webhooksQuery.data;
    const total = webhooksPage?.total ?? 0;
    const createMutation = useMutation({
        mutationFn: (input: {
            name: string;
        }) => dashboardApi.createWebhook(input),
        onSuccess: (result) => {
            setForm(null);
            setPage(1);
            setOneTimeUrl({ title: 'Webhook URL', url: result.url });
            void queryClient.invalidateQueries({ queryKey: ['dashboard-webhooks'] });
            toast.success('已创建');
        },
        onError: (error) => toast.danger(getWebhookErrorMessage(error, '创建失败')),
    });
    const updateMutation = useMutation({
        mutationFn: ({ id, input, }: {
            id: string;
            input: {
                name?: string;
                enabled?: boolean;
            };
        }) => dashboardApi.updateWebhook(id, input),
        onSuccess: (webhook) => {
            setForm(null);
            void queryClient.invalidateQueries({ queryKey: ['dashboard-webhooks'] });
            queryClient.setQueryData(['dashboard-webhook', webhook.id], webhook);
            toast.success('已保存');
        },
        onError: (error) => toast.danger(getWebhookErrorMessage(error, '保存失败')),
    });
    const deleteMutation = useMutation({
        mutationFn: (id: string) => dashboardApi.deleteWebhook(id),
        onSuccess: (_result, deletedId) => {
            setDeleteTarget(null);
            queryClient.removeQueries({ queryKey: ['dashboard-webhook', deletedId] });
            void queryClient.invalidateQueries({ queryKey: ['dashboard-webhooks'] });
            toast.success('已删除');
        },
        onError: (error) => toast.danger(getWebhookErrorMessage(error, '删除失败')),
    });
    const resetSecretMutation = useMutation({
        mutationFn: (id: string) => dashboardApi.resetWebhookSecret(id),
        onSuccess: (result) => {
            setResetSecretTarget(null);
            setOneTimeUrl({ title: '新的 Webhook URL', url: result.url });
            void queryClient.invalidateQueries({ queryKey: ['dashboard-webhooks'] });
            queryClient.setQueryData(['dashboard-webhook', result.webhook.id], result.webhook);
            toast.success('已重置');
        },
        onError: (error) => toast.danger(getWebhookErrorMessage(error, '重置失败')),
    });
    function submitForm(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!form)
            return;
        const name = form.name.trim();
        if (!name) {
            toast.danger('名称不能为空');
            return;
        }
        if (form.mode === 'create') {
            createMutation.mutate({ name });
            return;
        }
        if (form.webhook) {
            updateMutation.mutate({ id: form.webhook.id, input: { name } });
        }
    }
    const isSaving = createMutation.isPending || updateMutation.isPending;
    const columns = useMemo(() => buildWebhookColumns({
        onEdit: (webhook) => setForm({
            mode: 'edit',
            webhook,
            name: webhook.name,
        }),
        onToggle: (webhook) => updateMutation.mutate({
            id: webhook.id,
            input: { enabled: !webhook.enabled },
        }),
        onResetSecret: setResetSecretTarget,
        onOpenDeliveries: (webhook) => {
            void navigate({
                to: '/webhooks/$webhookId',
                params: { webhookId: webhook.id },
                search: { tab: 'deliveries' },
            });
        },
        onDelete: setDeleteTarget,
        isUpdating: updateMutation.isPending,
    }), [navigate, updateMutation]);
    return (<>
      <Header fixed>
        <h1 className='text-lg font-semibold'>Webhooks</h1>
      </Header>
      <Main className='flex flex-1 flex-col gap-4'>
        <ServerDataTable columns={columns} data={[...(webhooksPage?.data ?? [])]} page={page} pageSize={pageSize} total={total} error={webhooksQuery.isError ? webhooksQuery.error : null} onRetry={() => void webhooksQuery.refetch()} onPageChange={setPage} onPageSizeChange={setPageSize} isLoading={webhooksQuery.isLoading} loadingRowCount={Math.min(pageSize, DEFAULT_DASHBOARD_PAGE_SIZE)} emptyMessage='暂无 Webhook，点击“新建 Webhook”创建' toolbar={<div className='flex flex-wrap items-center gap-4'>
              <Button onPress={() => setForm({ mode: 'create', webhook: null, name: '' })}>
                <Plus data-icon='inline-start'/>
                新建 Webhook
              </Button>
              <Link href={consoleHref('/webhook-deliveries')}>全部触发记录</Link>
            </div>}/>

        <WebhookFormDialog form={form} isSaving={isSaving} onFormChange={setForm} onSubmit={submitForm}/>
        <WebhookUrlDialog open={Boolean(oneTimeUrl)} title={oneTimeUrl?.title ?? 'Webhook URL'} url={oneTimeUrl?.url ?? ''} onOpenChange={(open) => {
            if (!open)
                setOneTimeUrl(null);
        }}/>
        <ConfirmDialog open={Boolean(resetSecretTarget)} onOpenChange={(open) => {
            if (!open)
                setResetSecretTarget(null);
        }} title={webhookResetSecretDialogTitle} desc={getWebhookResetSecretDialogDescription(resetSecretTarget)} cancelBtnText='取消' confirmText='重置' destructive isLoading={resetSecretMutation.isPending} handleConfirm={() => {
            if (resetSecretTarget) {
                resetSecretMutation.mutate(resetSecretTarget.id);
            }
        }}/>
        <ConfirmDialog open={Boolean(deleteTarget)} onOpenChange={(open) => {
            if (!open)
                setDeleteTarget(null);
        }} title='删除 Webhook' desc={`删除「${deleteTarget?.name ?? ''}」后，接入地址立即失效，已有触发记录仍会保留。`} cancelBtnText='取消' confirmText='删除 Webhook' destructive isLoading={deleteMutation.isPending} handleConfirm={() => {
            if (deleteTarget)
                deleteMutation.mutate(deleteTarget.id);
        }}/>
      </Main>
    </>);
}
export function WebhookFormDialog({ form, isSaving, onFormChange, onSubmit, }: {
    form: WebhookFormState | null;
    isSaving: boolean;
    onFormChange: (form: WebhookFormState | null) => void;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
    return (<Modal.Backdrop isOpen={Boolean(form)} onOpenChange={(open) => {
            if (!open)
                onFormChange(null);
        }}><Modal.Container><Modal.Dialog>
        <Modal.CloseTrigger />
        <Modal.Header className='pe-10'>
          <Modal.Heading className='wrap-anywhere'>
            {form?.mode === 'edit' ? '重命名 Webhook' : '新建 Webhook'}
          </Modal.Heading>
        </Modal.Header>
        <Modal.Body>
          <form id='webhook-form' className='grid gap-4' onSubmit={onSubmit}>
            <TextField className='grid gap-2'>
              <Label htmlFor='webhook-name'>名称</Label>
              <Input variant="secondary" id='webhook-name' value={form?.name ?? ''} maxLength={80} autoFocus disabled={isSaving} onChange={(event) => {
              if (!form)
                  return;
              onFormChange({ ...form, name: event.target.value });
          }}></Input>
            </TextField>
          </form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline" isDisabled={isSaving} onPress={() => onFormChange(null)}>
            取消
          </Button>
          <Button type='submit' form='webhook-form' isPending={isSaving} isDisabled={!form?.name.trim()}>
            {form?.mode === 'edit' ? '保存名称' : '创建 Webhook'}
          </Button>
        </Modal.Footer>
      </Modal.Dialog></Modal.Container></Modal.Backdrop>);
}
export function removeDeletedWebhookFromCache(current: DashboardWebhookDto[] | undefined, deletedId: string): DashboardWebhookDto[] {
    return (current ?? []).filter((item) => item.id !== deletedId);
}
export function getWebhookDeliveriesHref(webhookId: string) {
    const query = new URLSearchParams({ webhookId });
    return `/webhook-deliveries?${query.toString()}`;
}
export function getWebhookDetailHref(webhookId: string) {
    return `/webhooks/${encodeURIComponent(webhookId)}`;
}
