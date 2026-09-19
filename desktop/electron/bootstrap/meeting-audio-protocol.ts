import { app, protocol } from "electron"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { Readable } from "node:stream"

import {
  MEETING_AUDIO_PROTOCOL_SCHEME,
  meetingAudioCacheRoot,
  parseByteRange,
  resolveMeetingAudioUrlId,
} from "../modules/meeting/audio-cache"

/**
 * 把本机缓存里的录音音频喂给渲染进程的 `<audio>`。
 *
 * **为什么不用 `net.fetch(pathToFileURL(...))`。** 仓库里服务图片的
 * `agent-artifact-protocol.ts` 就是那么写的，但它从没验过 Range。实测（Electron 41，
 * 一个 90 秒的 m4a）：
 *
 * | 写法 | 响应 | `<audio>` 的 `seekable` | 拖动 |
 * |---|---|---|---|
 * | `net.fetch(file://)` | 200，无 `Content-Range` | `[0, 0]` | 拖不动 |
 * | `net.fetch(file://, { headers: request.headers })` | 200，无 `Content-Range` | `[0, 0]` | 拖不动 |
 * | 这里这样自己回 206 | 206，带 `Content-Range` | `[0, 90]` | 正常 |
 *
 * 前两种不只是「慢」——波形照画、时长照显示，**进度条拖不动而且不报错**。所以这里自己
 * 解析 `Range`、自己读区间、自己回 206。
 *
 * 读的是文件流而不是整段读进内存：Chromium 的头一个请求是 `bytes=0-`，也就是「整个
 * 文件」，一个小时的录音就是 28 MB。
 */

let protocolRegistered = false

function registerMeetingAudioProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: MEETING_AUDIO_PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      // 响应体是流。范围请求本身不依赖它，但声明了才符合「这个协议会流式回数据」的语义。
      stream: true,
    },
  }])
}

function registerMeetingAudioProtocol(rootDirectory = meetingAudioCacheRoot(app.getPath("userData"))): void {
  if (protocolRegistered) return
  protocol.handle(MEETING_AUDIO_PROTOCOL_SCHEME, (request) => serveMeetingAudio(rootDirectory, request))
  protocolRegistered = true
}

async function serveMeetingAudio(rootDirectory: string, request: Request): Promise<Response> {
  const meetingId = resolveMeetingAudioUrlId(request.url)
  if (!meetingId) return notFoundResponse()

  const filePath = `${rootDirectory}/${meetingId}.m4a`
  let size: number
  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) return notFoundResponse()
    size = fileStat.size
  } catch {
    return notFoundResponse()
  }

  const range = parseByteRange(request.headers.get("range"), size)
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${size}`, "accept-ranges": "bytes" },
    })
  }
  const start = range ? range.start : 0
  const end = range ? range.end : size - 1
  const length = end - start + 1
  const headers = {
    "content-type": "audio/mp4",
    "content-length": String(length),
    "accept-ranges": "bytes",
    ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
  }

  // HEAD 只要头，不要体——给体反而会让调用方读到一个它没预期的长度。
  if (request.method === "HEAD") {
    return new Response(null, { status: range ? 206 : 200, headers })
  }

  const body = Readable.toWeb(createReadStream(filePath, { start, end })) as unknown as ReadableStream
  return new Response(body, { status: range ? 206 : 200, headers })
}

function notFoundResponse(): Response {
  return new Response("Not found", { status: 404 })
}

export {
  registerMeetingAudioProtocol,
  registerMeetingAudioProtocolScheme,
}
