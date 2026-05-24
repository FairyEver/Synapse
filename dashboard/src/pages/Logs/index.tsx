import { CloudDownloadOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { App, Button, DatePicker, Select, Space, Tag } from 'antd';
import React from 'react';

import { adminApi, type LogEntry, type LogFileInfo } from '@/services/synapse/api';
import { formatBytes, formatDate } from '@/utils/format';

const levelOptions = [
  { value: 'all', label: '全部' },
  { value: 'error', label: 'Error' },
  { value: 'fatal', label: 'Fatal' },
  { value: 'warn', label: 'Warn' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' },
];

export default function LogsPage() {
  const { message } = App.useApp();
  const entriesActionRef = React.useRef<ActionType>(null);
  const filesActionRef = React.useRef<ActionType>(null);
  const [level, setLevel] = React.useState('all');
  const [from, setFrom] = React.useState<string>();
  const [to, setTo] = React.useState<string>();
  const [cleanupBefore, setCleanupBefore] = React.useState<string>();

  const entryColumns: ProColumns<LogEntry>[] = [
    { title: '时间', dataIndex: 'time', render: (_, entry) => formatDate(entry.time) },
    { title: '级别', dataIndex: 'level', render: (_, entry) => <Tag>{entry.level}</Tag> },
    {
      title: '消息',
      render: (_, entry) => `${entry.req ? `${entry.req.method} ${entry.req.url} - ` : ''}${entry.msg}`,
      ellipsis: true,
    },
  ];

  const fileColumns: ProColumns<LogFileInfo>[] = [
    { title: '文件名', dataIndex: 'name', ellipsis: true },
    { title: '大小', dataIndex: 'size', render: (_, file) => formatBytes(file.size) },
    { title: '修改时间', dataIndex: 'modifiedAt', render: (_, file) => formatDate(file.modifiedAt) },
  ];

  return (
    <PageContainer title="系统日志">
      <Space direction="vertical" size="large">
        <ProTable<LogEntry>
          rowKey={(_, index) => String(index)}
          actionRef={entriesActionRef}
          search={false}
          columns={entryColumns}
          pagination={false}
          toolBarRender={() => [
            <Select
              key="level"
              value={level}
              options={levelOptions}
              onChange={(value) => {
                setLevel(value);
                entriesActionRef.current?.reload?.();
              }}
            />,
            <Button key="refresh" icon={<ReloadOutlined />} onClick={() => entriesActionRef.current?.reload?.()}>
              刷新
            </Button>,
          ]}
          request={async () => ({
            data: await adminApi.fetchRecentLogs({ level: level === 'all' ? undefined : level, limit: 200 }),
            success: true,
          })}
        />
        <ProTable<LogFileInfo>
          rowKey="name"
          actionRef={filesActionRef}
          search={false}
          columns={fileColumns}
          pagination={false}
          toolBarRender={() => [
            <DatePicker
              key="from"
              placeholder="开始日期"
              onChange={(_, value) => setFrom(typeof value === 'string' ? value : undefined)}
            />,
            <DatePicker
              key="to"
              placeholder="结束日期"
              onChange={(_, value) => setTo(typeof value === 'string' ? value : undefined)}
            />,
            <Button
              key="download-range"
              icon={<CloudDownloadOutlined />}
              disabled={!from && !to}
              onClick={async () => {
                try {
                  await adminApi.downloadLogs({ from, to });
                } catch (error) {
                  message.error(error instanceof Error ? error.message : '下载失败');
                }
              }}
            >
              按范围下载
            </Button>,
            <Button
              key="download-all"
              type="primary"
              icon={<CloudDownloadOutlined />}
              onClick={async () => {
                try {
                  await adminApi.downloadLogs();
                } catch (error) {
                  message.error(error instanceof Error ? error.message : '下载失败');
                }
              }}
            >
              下载全部
            </Button>,
            <DatePicker
              key="cleanup-before"
              placeholder="清理日期"
              onChange={(_, value) => setCleanupBefore(typeof value === 'string' ? value : undefined)}
            />,
            <Button
              key="cleanup"
              danger
              icon={<DeleteOutlined />}
              disabled={!cleanupBefore}
              onClick={async () => {
                if (!cleanupBefore) return;
                try {
                  await adminApi.cleanupLogs(cleanupBefore);
                  filesActionRef.current?.reload?.();
                } catch (error) {
                  message.error(error instanceof Error ? error.message : '清理失败');
                }
              }}
            >
              清理早于日期
            </Button>,
          ]}
          request={async () => ({ data: await adminApi.listLogFiles(), success: true })}
        />
      </Space>
    </PageContainer>
  );
}
