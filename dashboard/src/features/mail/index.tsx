import { Button, Chip, Drawer, Input, ListBox, Select } from '@heroui/react';
import { useMemo, type ReactNode } from 'react';
import { formatBytes } from '@synapse/shared';
import { type ColumnDef } from '@tanstack/react-table';
import { type AdminMailAddress, type AdminMailMessageDetail, type AdminMailMessageSummary } from '@/lib/api';
import { DataTableColumnHeader, DEFAULT_DASHBOARD_PAGE_SIZE, ServerDataTable } from '@/components/data-table';
import { Header } from '@/components/layout/header';
import { Main } from '@/components/layout/main';
import { LongText } from '@/components/long-text';
import { RelativeTime } from '@/components/relative-time';
import { useAdminMail, type MailSearch } from './use-admin-mail';
export type { MailSearch } from './use-admin-mail';
const allValue = 'all';
export default function MailPage({ search }: {
    search: MailSearch;
}) {
    const { page, setPage, pageSize, setPageSize, sorting, setSorting, query, setQuery, kind, setKind, teamId, setTeamId, from, setFrom, to, setTo, resetPage, selectedId, setSelectedId, listQuery, detailQuery, contextQuery, teamsQuery, contextItems, } = useAdminMail(search);
    const openMessage = setSelectedId;
    const columns = useMemo<ColumnDef<AdminMailMessageSummary>[]>(() => [
        {
            accessorKey: 'sentAt',
            header: ({ column }) => <DataTableColumnHeader column={column} title='时间'/>,
            cell: ({ row }) => <RelativeTime className='tabular-nums' value={row.original.sentAt} mode='absolute'/>,
            meta: { label: '时间', className: 'w-44' },
        },
        {
            id: 'sender',
            header: '发件人',
            cell: ({ row }) => (<div className='flex min-w-0 items-center gap-2'>
          <LongText>{formatSender(row.original.sender)}</LongText>
          {row.original.senderDeletedAt ? <Chip color="default">已删除</Chip> : null}
        </div>),
            enableSorting: false,
            meta: { className: 'w-44' },
        },
        {
            accessorKey: 'subject',
            header: ({ column }) => <DataTableColumnHeader column={column} title='主题'/>,
            cell: ({ row }) => (<div className='min-w-0'>
          <div className='flex min-w-0 items-center gap-2'>
            <LongText className='font-medium'>{row.original.subject}</LongText>
            {row.original.kind === 'platform_broadcast' ? <Chip color="default">平台公告</Chip> : null}
          </div>
          <span className='block truncate text-muted'>{row.original.snippet}</span>
        </div>),
            meta: { label: '主题', className: 'w-80 max-w-80' },
        },
        {
            id: 'recipients',
            header: '收件人',
            cell: ({ row }) => <LongText>{formatAddresses(row.original.toAddresses)}</LongText>,
            enableSorting: false,
            meta: { className: 'w-48' },
        },
        {
            id: 'team',
            header: '团队',
            cell: ({ row }) => row.original.team?.name ?? '平台',
            enableSorting: false,
            meta: { className: 'w-32' },
        },
        {
            id: 'actions',
            cell: ({ row }) => (<div className='flex justify-end'>
          <Button variant='ghost' size='sm' onPress={() => { openMessage(row.original.messageId); }}>
            查看
          </Button>
        </div>),
            enableSorting: false,
            enableHiding: false,
            meta: { className: 'w-20', thClassName: 'text-right', tdClassName: 'text-right' },
        },
    ], [openMessage]);
    return (<>
      <Header fixed>
        <h1 className='text-lg font-semibold'>站内信</h1>
      </Header>
      <Main>
        <ServerDataTable columns={columns} data={listQuery.data?.data ?? []} page={page} pageSize={pageSize} total={listQuery.data?.total ?? 0} error={listQuery.isError ? listQuery.error : null} isLoading={listQuery.isLoading} loadingRowCount={Math.min(pageSize, DEFAULT_DASHBOARD_PAGE_SIZE)} onRetry={() => void listQuery.refetch()} onPageChange={setPage} onPageSizeChange={setPageSize} sorting={sorting} onSortingChange={setSorting} toolbar={<div className='flex flex-wrap items-center gap-2'>
              <Input placeholder='主题、正文、发件人或收件人' value={query} onChange={(event) => { setQuery(event.target.value); resetPage(); }} className='w-56 lg:w-72'/>
              <Select aria-label="全部类型" value={kind || allValue} onChange={(key) => ((value) => { setKind(value === allValue ? '' : value); resetPage(); })(String(key ?? ''))}>
                <Select.Trigger className='w-32'><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover><ListBox>
                  <ListBox.Item id={allValue}>全部类型<ListBox.ItemIndicator /></ListBox.Item>
                  <ListBox.Item id='user'>用户信件<ListBox.ItemIndicator /></ListBox.Item>
                  <ListBox.Item id='platform_broadcast'>平台公告<ListBox.ItemIndicator /></ListBox.Item>
                </ListBox></Select.Popover>
              </Select>
              <Select aria-label="全部团队" value={teamId || allValue} onChange={(key) => ((value) => { setTeamId(value === allValue ? '' : value); resetPage(); })(String(key ?? ''))}>
                <Select.Trigger className='w-36'><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover><ListBox>
                  <ListBox.Item id={allValue}>全部团队<ListBox.ItemIndicator /></ListBox.Item>
                  {teamsQuery.data?.data.map((team) => <ListBox.Item key={team.id} id={team.id}>{team.name}<ListBox.ItemIndicator /></ListBox.Item>)}
                </ListBox></Select.Popover>
              </Select>
              <Input aria-label='开始日期' type='date' value={from} onChange={(event) => { setFrom(event.target.value); resetPage(); }} className='w-36'/>
              <Input aria-label='结束日期' type='date' value={to} onChange={(event) => { setTo(event.target.value); resetPage(); }} className='w-36'/>
            </div>} getRowProps={(row) => ({
            'aria-label': `查看 ${row.original.subject}`,
            onAction: () => openMessage(row.original.messageId),
        })}/>
      </Main>

      <Drawer.Backdrop isOpen={selectedId !== null} onOpenChange={(open) => { if (!open)
        setSelectedId(null); }}>
        <Drawer.Content placement="right"><Drawer.Dialog className='sm:max-w-xl'><Drawer.CloseTrigger />
          <Drawer.Header className='pe-10'>
            <Drawer.Heading className='min-w-0 wrap-anywhere'>{detailQuery.data?.subject ?? '站内信详情'}</Drawer.Heading>
            <p className='sr-only'>查看站内信正文和往来记录</p>
          </Drawer.Header>
          <Drawer.Body>
            {detailQuery.isLoading ? <div role='status' className='text-sm text-muted'>加载中</div> : null}
            {detailQuery.isError ? <div role='alert' className='grid gap-2 text-sm'><span className='text-danger'>{detailQuery.error.message}</span><Button variant='outline' onPress={() => void detailQuery.refetch()}>重试</Button></div> : null}
            {detailQuery.data ? (<MailDetail detail={detailQuery.data} context={contextItems} contextHasMore={contextQuery.hasNextPage} contextLoading={contextQuery.isFetching} contextError={contextQuery.isError ? contextQuery.error : null} onRetryContext={() => void contextQuery.refetch()} onLoadMore={() => void contextQuery.fetchNextPage()} onOpenMessage={openMessage}/>) : null}
          </Drawer.Body>
        </Drawer.Dialog></Drawer.Content>
      </Drawer.Backdrop>
    </>);
}
function MailDetail({ detail, context, contextHasMore, contextError, onRetryContext, contextLoading, onLoadMore, onOpenMessage, }: {
    detail: AdminMailMessageDetail;
    context: AdminMailMessageDetail[];
    contextHasMore: boolean;
    contextError: Error | null;
    onRetryContext: () => void;
    contextLoading: boolean;
    onLoadMore: () => void;
    onOpenMessage: (id: string) => void;
}) {
    return (<div className='grid gap-5 text-sm'>
      <div className='grid gap-2'>
        <DetailField label='发件人'><span className='inline-flex items-center gap-2'>{formatSender(detail.sender)}{detail.senderDeletedAt ? <Chip color="default">已删除</Chip> : null}</span></DetailField>
        <DetailField label='收件人'>{formatAddresses(detail.toAddresses)}</DetailField>
        {detail.ccAddresses.length ? <DetailField label='抄送'>{formatAddresses(detail.ccAddresses)}</DetailField> : null}
        <DetailField label='团队'>{detail.team?.name ?? '平台公告'}</DetailField>
        <DetailField label='时间'><RelativeTime value={detail.sentAt} mode='absolute'/></DetailField>
        <DetailField label='投递状态'>收件人 {detail.delivery.recipientCount} / 已读 {detail.delivery.readCount} / 已删除 {detail.delivery.deletedCount} / 未读 {detail.delivery.pendingCount}</DetailField>
      </div>
      <MessageBody message={detail}/>
      <section className='grid gap-3' aria-label='站内信往来'>
        <h2 className='font-medium'>往来</h2>
        {context.map((message) => (<article key={message.messageId} className='grid gap-2 border-t pt-3'>
            <div className='flex flex-wrap items-center gap-2'>
              <Button type='button' variant='ghost' size='sm' onPress={() => onOpenMessage(message.messageId)}>{formatSender(message.sender)}</Button>
              <RelativeTime className='text-muted' value={message.sentAt} mode='absolute'/>
              {message.messageId === detail.messageId ? <Chip color="default">当前信件</Chip> : null}
              {message.relationKind ? <Chip color="default">{message.relationKind === 'reply' ? '回复' : '转发'}</Chip> : null}
            </div>
            <span className='font-medium'>{message.subject}</span>
            {message.messageId !== detail.messageId ? <MessageBody message={message}/> : null}
          </article>))}
        {contextLoading ? <div className='text-muted'>加载往来中</div> : null}
        {contextError ? <div role='alert' className='grid gap-2'><span className='text-danger'>{contextError.message}</span><Button variant='outline' onPress={onRetryContext}>重试往来</Button></div> : null}
        {!contextLoading && !contextError && !context.length ? <div className='text-muted'>暂无往来</div> : null}
        {contextHasMore ? <Button variant='outline' isDisabled={contextLoading} onPress={onLoadMore}>加载更早往来</Button> : null}
      </section>
    </div>);
}
function MessageBody({ message }: {
    message: AdminMailMessageDetail;
}) {
    return (<div className='grid gap-2'>
      <pre className='whitespace-pre-wrap break-words font-sans text-sm'>{message.body}</pre>
      {message.attachments.length ? <div className='grid gap-1 text-muted'>
        <span className='font-medium text-foreground'>附件</span>
        {message.attachments.map((attachment) => <span key={attachment.attachmentId}>{attachment.fileName} · {attachment.mimeType ?? '未知类型'} · {formatBytes(attachment.size)}</span>)}
      </div> : null}
    </div>);
}
function DetailField({ label, children }: {
    label: string;
    children: ReactNode;
}) {
    return <div className='grid gap-1'><span className='text-xs font-medium text-muted'>{label}</span><div className='break-words'>{children}</div></div>;
}
function formatSender(sender: AdminMailMessageSummary['sender']) {
    if (sender.userId === 'platform')
        return sender.nickname;
    return `${sender.nickname || sender.handle} · ${sender.email}`;
}
function formatAddresses(addresses: AdminMailAddress[]) {
    if (!addresses.length)
        return '-';
    return addresses.map((address) => address.kind === 'organization' ? `组织：${address.name}` : address.name).join('、');
}
