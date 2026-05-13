import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { execFile } from 'child_process'
import { readFile } from 'fs/promises'
import { extname, join, normalize, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { loadUiConfig, saveUiConfig, type UiConfig } from './config.js'
import { AutoScheduler } from './scheduler.js'
import { c } from './ui.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_DIR = resolve(__dirname, 'web')
const DEFAULT_PORT = 47831

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function sendError(res: ServerResponse, statusCode: number, message: string): void {
  sendJson(res, statusCode, { error: message })
}

function contentType(path: string): string {
  switch (extname(path)) {
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.html':
      return 'text/html; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim()
  return raw ? JSON.parse(raw) : {}
}

async function serveFile(res: ServerResponse, path: string): Promise<void> {
  const body = await readFile(path)
  res.writeHead(200, {
    'content-type': contentType(path),
    'content-length': body.byteLength,
  })
  res.end(body)
}

async function serveAsset(res: ServerResponse, pathname: string): Promise<void> {
  const relative = normalize(decodeURIComponent(pathname.replace(/^\/assets\//, '')))
  const path = resolve(WEB_DIR, relative)
  if (!path.startsWith(WEB_DIR)) {
    sendError(res, 400, 'Invalid asset path')
    return
  }
  await serveFile(res, path)
}

function openBrowser(url: string): void {
  const commands =
    process.platform === 'darwin'
      ? { command: 'open', args: [url] }
      : process.platform === 'win32'
        ? { command: 'cmd', args: ['/c', 'start', '', url] }
        : { command: 'xdg-open', args: [url] }

  const child = execFile(commands.command, commands.args, { windowsHide: true }, () => {})
  child.unref()
}

function createHandler(scheduler: AutoScheduler) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')

      if (req.method === 'GET' && url.pathname === '/') {
        await serveFile(res, join(WEB_DIR, 'index.html'))
        return
      }

      if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
        await serveAsset(res, url.pathname)
        return
      }

      if (req.method === 'GET' && url.pathname === '/api/config') {
        sendJson(res, 200, await loadUiConfig())
        return
      }

      if (req.method === 'PUT' && url.pathname === '/api/config') {
        sendJson(res, 200, await saveUiConfig(await readJson(req)))
        return
      }

      if (req.method === 'POST' && url.pathname === '/api/start') {
        const config = await saveUiConfig(await readJson(req))
        void scheduler.start(config)
        sendJson(res, 200, scheduler.getSnapshot())
        return
      }

      if (req.method === 'POST' && url.pathname === '/api/stop-after-current') {
        scheduler.stopAfterCurrent()
        sendJson(res, 200, scheduler.getSnapshot())
        return
      }

      if (req.method === 'GET' && url.pathname === '/api/status') {
        sendJson(res, 200, scheduler.getSnapshot())
        return
      }

      if (req.method === 'GET' && url.pathname === '/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        const send = (snapshot: unknown): void => {
          res.write(`data: ${JSON.stringify(snapshot)}\n\n`)
        }
        const unsubscribe = scheduler.subscribe(send)
        req.on('close', unsubscribe)
        return
      }

      sendError(res, 404, 'Not found')
    } catch (err) {
      sendError(res, 500, err instanceof Error ? err.message : String(err))
    }
  }
}

async function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolvePort(port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

export async function startServer(options: { port?: number; open?: boolean } = {}): Promise<{ server: Server; url: string }> {
  const scheduler = new AutoScheduler()
  let port = options.port ?? DEFAULT_PORT

  while (true) {
    const server = createServer((req, res) => {
      void createHandler(scheduler)(req, res)
    })
    try {
      const actualPort = await listen(server, port)
      const url = `http://127.0.0.1:${actualPort}`
      console.log(`${c.boldCyan('◆')} ${c.bold('auto')} ${c.dim('listening at')} ${c.cyan(url)}`)
      if (options.open !== false) openBrowser(url)
      return { server, url }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err
      port++
    }
  }
}

export async function runSavedConfigOnce(): Promise<void> {
  const { runBatch } = await import('./runner.js')
  const config: UiConfig = await loadUiConfig()
  const result = await runBatch(config)
  console.log(`${c.boldGreen('✓')} ${c.bold('batch complete')} ${c.dim(result.summaryPath)}`)
}
