import { CloudDownloadOutlined, DeleteOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { App, Button, Popconfirm, Space } from 'antd';
import React from 'react';

import { adminApi, type BackupFile } from '@/services/synapse/api';
import { formatBytes, formatDate } from '@/utils/format';

export default function BackupPage() {
  const { message } = App.useApp();
  const actionRef = React.useRef<ActionType>(null);

  const columns: ProColumns<BackupFile>[] = [
    { title: '文件名', dataIndex: 'filename', ellipsis: true },
    { title: '大小', dataIndex: 'size', render: (_, file) => formatBytes(file.size) },
    { title: '备份时间', dataIndex: 'createdAt', render: (_, file) => formatDate(file.createdAt) },
    {
      title: '操作',
      valueType: 'option',
      render: (_, file) => (
        <Space>
          <Button
            size="small"
            icon={<CloudDownloadOutlined />}
            onClick={async () => {
              try {
                await adminApi.downloadBackup(file.filename);
              } catch (error) {
                message.error(error instanceof Error ? error.message : '下载失败');
              }
            }}
          >
            下载
          </Button>
          <Popconfirm
            title="删除备份"
            onConfirm={async () => {
              try {
                await adminApi.deleteBackup(file.filename);
                actionRef.current?.reload?.();
              } catch (error) {
                message.error(error instanceof Error ? error.message : '删除失败');
              }
            }}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <PageContainer title="备份管理">
      <ProTable<BackupFile>
        rowKey="filename"
        actionRef={actionRef}
        search={false}
        columns={columns}
        pagination={false}
        toolBarRender={() => [
          <Button
            key="backup"
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={async () => {
              try {
                const result = await adminApi.triggerBackup();
                message.success(`已备份 ${result.filename}`);
                actionRef.current?.reload?.();
              } catch (error) {
                message.error(error instanceof Error ? error.message : '备份失败');
              }
            }}
          >
            立即备份
          </Button>,
        ]}
        request={async () => ({ data: await adminApi.listBackups(), success: true })}
      />
    </PageContainer>
  );
}
