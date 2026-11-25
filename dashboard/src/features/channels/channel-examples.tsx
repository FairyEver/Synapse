import { Button, Card, Link, toast } from '@heroui/react'
import { Copy } from 'lucide-react'
import { buildChannelWsUrl } from './channel-api'

export function ChannelExamples({ channelId }: { channelId: string }) {
  const origin = window.location.origin
  const wsUrl = buildChannelWsUrl(channelId)
  const httpEventsUrl = `${origin}/api/open/v1/channels/${channelId}/events`

  const browserSnippet = `const ws = new WebSocket(${JSON.stringify(wsUrl)});
let lastSeq = 0;

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "auth",
    token: "syc_YOUR_CHANNEL_TOKEN",
    clientId: "screen-1",
    clientName: "展示屏",
    afterSeq: lastSeq || undefined,
    includeRetained: true,
  }));
};

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "ready") lastSeq = msg.latestSeq;
  if (msg.type === "event") {
    lastSeq = Math.max(lastSeq, msg.seq);
    // 处理实时事件 msg.event / msg.payload
  }
};`

  const nodeSnippet = `import WebSocket from "ws";

const ws = new WebSocket(${JSON.stringify(wsUrl)}, {
  headers: { Authorization: "Bearer " + process.env.SY_CHANNEL_TOKEN },
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString("utf8"));
  if (msg.type === "event" && msg.event === "command.run") {
    ws.send(JSON.stringify({
      type: "publish",
      event: "command.result",
      payload: { ok: true },
      targetClientId: msg.sender?.clientId || undefined,
    }));
  }
});`

  const curlSnippet = `curl --fail-with-body -X POST ${JSON.stringify(httpEventsUrl)} \\
  -H "Authorization: Bearer syc_YOUR_PUBLISH_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"event":"slide.next","payload":{"step":1},"retain":false}'`

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`已复制${label}`)
    } catch {
      toast.danger('复制失败，请手动复制')
    }
  }

  return (
    <div className='space-y-4'>
      <Card className='shadow-none'>
        <Card.Header className='flex flex-row items-center justify-between gap-2'>
          <Card.Title className='text-base'>连接地址</Card.Title>
          <Link href='/document/open-api/api/channels' target='_blank' rel='noreferrer'>
            完整开放文档
            <Link.Icon />
          </Link>
        </Card.Header>
        <Card.Content className='space-y-2 text-sm'>
          <div>
            <span className='text-muted'>WebSocket：</span>
            <code className='break-all font-mono'>{wsUrl}</code>
          </div>
          <div>
            <span className='text-muted'>HTTP 发布：</span>
            <code className='break-all font-mono'>{httpEventsUrl}</code>
          </div>
        </Card.Content>
      </Card>

      {[
        { title: '浏览器 WebSocket（首帧 auth）', code: browserSnippet },
        { title: 'Node.js 后端服务（Upgrade Header）', code: nodeSnippet },
        { title: 'curl 无状态发布事件', code: curlSnippet },
      ].map((block) => (
        <Card key={block.title} className='shadow-none'>
          <Card.Header className='flex flex-row items-center justify-between gap-2'>
            <Card.Title className='text-base'>{block.title}</Card.Title>
            <Button variant='secondary' onPress={() => void copy(block.code, block.title)}>
              <Copy />
              复制
            </Button>
          </Card.Header>
          <Card.Content>
            <pre className='overflow-x-auto rounded-lg border border-border bg-surface-secondary p-3 font-mono text-xs'>
              {block.code}
            </pre>
          </Card.Content>
        </Card>
      ))}
    </div>
  )
}
