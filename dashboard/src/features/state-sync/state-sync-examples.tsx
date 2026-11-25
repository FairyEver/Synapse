import { useQuery } from '@tanstack/react-query'
import { Button, Card, Chip, Link, toast } from '@heroui/react'
import { Copy } from 'lucide-react'
import { stateSyncApi } from './state-sync-api'

const FALLBACK_VERSION = '1.0.0'
const FALLBACK_GLOBAL_PATH = '/sdk/state-sync/v1/state-sync.global.min.js'
const FALLBACK_ESM_PATH = '/sdk/state-sync/v1/state-sync.esm.min.js'

export function StateSyncExamples({ spaceId }: { spaceId: string }) {
  const origin = window.location.origin
  const wsOrigin = origin.replace(/^https:\/\//iu, 'wss://').replace(/^http:\/\//iu, 'ws://')

  const manifestQuery = useQuery({
    queryKey: ['state-sync', 'sdk-manifest'],
    queryFn: ({ signal }) => stateSyncApi.getSdkManifest(signal),
    staleTime: 60_000,
  })

  const sdkEntry = manifestQuery.data?.sdks?.['state-sync']
  const latestVersion = sdkEntry?.latest ?? FALLBACK_VERSION
  const globalPath = sdkEntry?.files?.browserGlobal?.latestUrl ?? FALLBACK_GLOBAL_PATH
  const esmPath = sdkEntry?.files?.esm?.latestUrl ?? FALLBACK_ESM_PATH
  const docsUrl = sdkEntry?.docsUrl ?? '/document/open-api/api/state-sync'
  const globalUrl = `${origin}${globalPath}`
  const esmUrl = `${origin}${esmPath}`
  const httpDocPatchUrl = `${origin}/api/open/v1/state-sync/spaces/${spaceId}/docs/ROOM_DOC_ID`
  const wsTemplateUrl = `${wsOrigin}/api/open/v1/state-sync/spaces/${spaceId}/docs/<docId>/ws`

  const browserGlobalSnippet = `<script src="${globalUrl}"></script>
<script>
  async function main() {
    const client = window.SynapseStateSync.createClient({
      baseUrl: ${JSON.stringify(origin)},
      spaceId: ${JSON.stringify(spaceId)},
      token: "sys_YOUR_CREATE_WRITE_TOKEN",
    });

    const { docId, room } = await client.createRoom({
      initialData: { score: 0, players: {} },
      clientId: "player-1",
      clientName: "玩家 1",
      paths: ["/"],
    });

    room.on("/score", (value, meta) => {
      // 处理路径更新 value / meta.rev
    });
    await room.onDisconnect([
      { op: "set", path: "/players/player-1/online", value: false },
    ]);
    // 主动离开：await room.clearOnDisconnect(); room.close();
  }
  main();
</script>`

  const browserEsmSnippet = `<script type="module">
  import { createClient } from ${JSON.stringify(esmUrl)};

  const client = createClient({
    baseUrl: ${JSON.stringify(origin)},
    spaceId: ${JSON.stringify(spaceId)},
    token: "sys_YOUR_WRITE_TOKEN",
  });

  const room = await client.join("ROOM_DOC_ID", {
    clientId: "player-2",
    clientName: "玩家 2",
    paths: ["/"],
  });

  await room.patch("/players/player-2", { online: true, score: 0 });
  await room.onDisconnect([
    { op: "delete", path: "/players/player-2" },
  ]);
  // 主动离开：await room.clearOnDisconnect(); room.close();
</script>`

  const nodeSnippet = `# 1. 下载零依赖单文件 SDK（Node.js 22+）
curl -fsSL ${esmUrl} -o ./synapse-state-sync.mjs

# 2. 在业务脚本中直接导入使用
# import { createClient } from "./synapse-state-sync.mjs";
#
# const client = createClient({
#   baseUrl: ${JSON.stringify(origin)},
#   spaceId: ${JSON.stringify(spaceId)},
#   token: process.env.SYNAPSE_SPACE_TOKEN,
# });
#
# const { docId, room } = await client.createRoom({
#   initialData: { round: 1 },
#   paths: ["/"],
# });
# await room.set("/round", 2);
# await room.clearOnDisconnect();
# room.close();`

  const httpPatchSnippet = `curl --fail-with-body -X PATCH ${JSON.stringify(httpDocPatchUrl)} \\
  -H "Authorization: Bearer sys_YOUR_WRITE_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"op":"set","path":"/score","value":100,"expectedRev":0}'`

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
        <Card.Header className='flex flex-row flex-wrap items-center justify-between gap-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <Card.Title className='text-base'>SDK 与接入地址</Card.Title>
            <Chip size='sm' variant='soft'>SDK v{latestVersion}</Chip>
          </div>
          <Link href={docsUrl} target='_blank' rel='noreferrer'>
            完整开放文档
            <Link.Icon />
          </Link>
        </Card.Header>
        <Card.Content className='space-y-2 text-sm'>
          <div>
            <span className='text-muted'>Base URL：</span>
            <code className='break-all font-mono'>{origin}</code>
          </div>
          <div>
            <span className='text-muted'>Space ID：</span>
            <code className='break-all font-mono'>{spaceId}</code>
          </div>
          <div>
            <span className='text-muted'>WebSocket：</span>
            <code className='break-all font-mono'>{wsTemplateUrl}</code>
          </div>
          <div>
            <span className='text-muted'>SDK Manifest：</span>
            <code className='break-all font-mono'>{`${origin}/sdk/manifest.json`}</code>
          </div>
        </Card.Content>
      </Card>

      {[
        { title: '浏览器 <script> 引入（全局 SynapseStateSync）', code: browserGlobalSnippet },
        { title: '浏览器原生 ESM 引入（import { createClient }）', code: browserEsmSnippet },
        { title: 'Node.js 22+ 零安装（curl 单文件 + import）', code: nodeSnippet },
        { title: 'HTTP PATCH 修改路径状态（curl）', code: httpPatchSnippet },
      ].map((block) => (
        <Card key={block.title} className='shadow-none'>
          <Card.Header className='flex flex-row flex-wrap items-center justify-between gap-2'>
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
