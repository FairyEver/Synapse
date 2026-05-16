import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { execFile } from 'child_process'
import { readFile } from 'fs/promises'
import { extname, join, normalize, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { loadUiConfig, saveUiConfig, type UiConfig } from './config.js'
import { createPrompt, deletePrompt, readPrompt, renamePrompt, type PromptLibraryPaths } from './prompt-library.js'
import { AutoScheduler } from './scheduler.js'
import type { OutputLine } from './runner.js'
import { c } from './ui.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_DIR = resolve(__dirname, '../dist/web')
const GUIDE_PATH = resolve(__dirname, '../GUIDE.md')
const DEFAULT_PORT = 47831

export class OutputBuffer {
  private lines = new Map<number, OutputLine[]>()
  private maxPerWorker: number

  constructor(maxPerWorker = 2000) {
    this.maxPerWorker = maxPerWorker
  }

  append(line: OutputLine): void {
    let bucket = this.lines.get(line.workerId)
    if (!bucket) {
      bucket = []
      this.lines.set(line.workerId, bucket)
    }
    bucket.push(line)
    if (bucket.length > this.maxPerWorker) {
      bucket.splice(0, bucket.length - this.maxPerWorker)
    }
  }

  reset(): void {
    this.lines.clear()
  }

  getAll(): Record<number, OutputLine[]> {
    const result: Record<number, OutputLine[]> = {}
    for (const [id, lines] of this.lines) {
      result[id] = [...lines]
    }
    return result
  }
}

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

function promptNameFromPath(pathname: string, prefix: string): string {
  return decodeURIComponent(pathname.slice(prefix.length))
}

function bodyName(body: unknown, field: string): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error(`${field} is required`)
  }
  const value = (body as Record<string, unknown>)[field]
  if (typeof value !== 'string') throw new Error(`${field} is required`)
  return value
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

interface HandlerPaths extends PromptLibraryPaths {
  configPath?: string
  guidePath?: string
  promptPath?: string
}

export function createHandler(scheduler: AutoScheduler, outputBuffer: OutputBuffer, paths: HandlerPaths = {}) {
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
        sendJson(res, 200, await loadUiConfig(paths.configPath, paths.promptPath, paths.promptsDir))
        return
      }

      if (req.method === 'GET' && url.pathname === '/api/guide') {
        sendJson(res, 200, { content: await readFile(paths.guidePath ?? GUIDE_PATH, 'utf-8') })
        return
      }

      if (req.method === 'PUT' && url.pathname === '/api/config') {
        sendJson(res, 200, await saveUiConfig(await readJson(req), paths.configPath, paths.promptPath, paths.promptsDir))
        return
      }

      if (req.method === 'POST' && url.pathname === '/api/prompts') {
        const body = await readJson(req)
        const name = bodyName(body, 'name')
        await createPrompt(name, paths)
        sendJson(res, 200, await loadUiConfig(paths.configPath, paths.promptPath, paths.promptsDir))
        return
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/prompts/')) {
        const name = promptNameFromPath(url.pathname, '/api/prompts/')
        sendJson(res, 200, { name, prompt: await readPrompt(name, paths) })
        return
      }

      if (req.method === 'PUT' && url.pathname.startsWith('/api/prompts/') && url.pathname.endsWith('/rename')) {
        const prefix = '/api/prompts/'
        const name = decodeURIComponent(url.pathname.slice(prefix.length, -'/rename'.length))
        const body = await readJson(req)
        const nextName = bodyName(body, 'name')
        const current = await loadUiConfig(paths.configPath, paths.promptPath, paths.promptsDir)
        await renamePrompt(name, nextName, paths)
        const activePromptName = current.activePromptName === name ? nextName : current.activePromptName
        const config = await saveUiConfig({
          ...current,
          activePromptName,
          prompt: await readPrompt(activePromptName, paths),
        }, paths.configPath, paths.promptPath, paths.promptsDir)
        sendJson(res, 200, config)
        return
      }

      if (req.method === 'DELETE' && url.pathname.startsWith('/api/prompts/')) {
        const name = promptNameFromPath(url.pathname, '/api/prompts/')
        await deletePrompt(name, paths)
        sendJson(res, 200, await loadUiConfig(paths.configPath, paths.promptPath, paths.promptsDir))
        return
      }

      if (req.method === 'POST' && url.pathname === '/api/start') {
        const config = await saveUiConfig(await readJson(req), paths.configPath, paths.promptPath, paths.promptsDir)
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

      if (req.method === 'GET' && url.pathname === '/api/workers/output') {
        sendJson(res, 200, { workers: outputBuffer.getAll() })
        return
      }

      if (req.method === 'GET' && url.pathname === '/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        const sendSnapshot = (snapshot: unknown): void => {
          res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)
        }
        const sendOutput = (line: OutputLine): void => {
          res.write(`event: output\ndata: ${JSON.stringify(line)}\n\n`)
        }
        const unsubSnapshot = scheduler.subscribe(sendSnapshot)
        const unsubOutput = scheduler.subscribeOutput(sendOutput)
        req.on('close', () => {
          unsubSnapshot()
          unsubOutput()
        })
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
  const outputBuffer = new OutputBuffer()

  scheduler.subscribeOutput(line => outputBuffer.append(line))

  let lastBatchId = ''
  scheduler.subscribe(snapshot => {
    const batchId = snapshot.currentBatch?.id ?? ''
    if (batchId && batchId !== lastBatchId) {
      outputBuffer.reset()
      lastBatchId = batchId
    }
  })

  let port = options.port ?? DEFAULT_PORT

  while (true) {
    const server = createServer((req, res) => {
      void createHandler(scheduler, outputBuffer)(req, res)
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
