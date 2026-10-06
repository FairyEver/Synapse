#!/usr/bin/env node

import { spawn as defaultSpawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import { Readable, Writable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"

const DEFAULT_ROUNDS = 3
const DEFAULT_SIZE_MB = 10
const DEFAULT_TIMEOUT_MS = 60_000
// 与 deploy.sh 的默认生产服务器保持一致，可用 SYNAPSE_DEPLOY_SERVER 覆盖。
const DEFAULT_SSH_TARGET = "root@120.53.17.64"
const MAX_ROUNDS = 20
const MAX_SIZE_MB = 1_024
const RANDOM_CHUNK_BYTES = 1024 * 1024

function parsePositiveInteger(value, optionName, maximum) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || (maximum !== undefined && parsed > maximum)) {
    const range = maximum === undefined ? "正整数" : `1 到 ${maximum} 的整数`
    throw new Error(`${optionName} 必须是${range}`)
  }

  return parsed
}

function parsePositiveNumber(value, optionName, maximum) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || (maximum !== undefined && parsed > maximum)) {
    throw new Error(`${optionName} 必须大于 0${maximum === undefined ? "" : ` 且不超过 ${maximum}`}`)
  }

  return parsed
}

function parseHttpUrl(value, optionName) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${optionName} 必须是完整的 http(s) URL`)
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${optionName} 只支持 http 或 https URL`)
  }

  return parsed
}

function appendPath(baseUrl, path) {
  const base = new URL(baseUrl)
  const basePath = base.pathname.replace(/\/+$/u, "")
  base.pathname = `${basePath}${path}`
  base.search = ""
  base.hash = ""
  return base.toString()
}

function resolveEndpointUrls({ serverUrl, downloadUrl, uploadUrl }) {
  if (!serverUrl && (!downloadUrl || !uploadUrl)) {
    throw new Error("请提供 --server，或同时提供 --download-url 和 --upload-url")
  }

  const server = serverUrl ? parseHttpUrl(serverUrl, "--server") : undefined
  const resolvedDownloadUrl = downloadUrl
    ? parseHttpUrl(downloadUrl, "--download-url").toString()
    : appendPath(server, "/speedtest/download")
  const resolvedUploadUrl = uploadUrl
    ? parseHttpUrl(uploadUrl, "--upload-url").toString()
    : appendPath(server, "/speedtest/upload")

  return {
    downloadUrl: resolvedDownloadUrl,
    uploadUrl: resolvedUploadUrl,
  }
}

function parseArgs(args, env = process.env) {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args
  const options = {
    serverUrl: env.SYNAPSE_SPEEDTEST_SERVER ?? env.SPEEDTEST_SERVER_URL,
    downloadUrl: env.SYNAPSE_SPEEDTEST_DOWNLOAD_URL,
    uploadUrl: env.SYNAPSE_SPEEDTEST_UPLOAD_URL,
    sshTarget: env.SYNAPSE_SPEEDTEST_SSH_TARGET ?? env.SYNAPSE_DEPLOY_SERVER ?? DEFAULT_SSH_TARGET,
    rounds: DEFAULT_ROUNDS,
    sizeMb: DEFAULT_SIZE_MB,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    help: false,
  }
  let sshTargetProvided = false

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const token = normalizedArgs[index]
    const equalsIndex = token.indexOf("=")
    const optionName = equalsIndex === -1 ? token : token.slice(0, equalsIndex)
    const inlineValue = equalsIndex === -1 ? undefined : token.slice(equalsIndex + 1)

    if (optionName === "--help" || optionName === "-h") {
      options.help = true
      continue
    }

    const readValue = () => {
      const value = inlineValue ?? normalizedArgs[index + 1]
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${optionName} 缺少参数值`)
      }
      if (inlineValue === undefined) index += 1
      return value
    }

    if (optionName === "--server" || optionName === "--url") {
      options.serverUrl = readValue()
      continue
    }

    if (optionName === "--download-url") {
      options.downloadUrl = readValue()
      continue
    }

    if (optionName === "--upload-url") {
      options.uploadUrl = readValue()
      continue
    }

    if (optionName === "--ssh-target") {
      options.sshTarget = readValue()
      sshTargetProvided = true
      continue
    }

    if (optionName === "--rounds") {
      options.rounds = parsePositiveInteger(readValue(), optionName, MAX_ROUNDS)
      continue
    }

    if (optionName === "--size-mb") {
      options.sizeMb = parsePositiveNumber(readValue(), optionName, MAX_SIZE_MB)
      continue
    }

    if (optionName === "--timeout-ms") {
      options.timeoutMs = parsePositiveInteger(readValue(), optionName)
      continue
    }

    throw new Error(`未知参数：${optionName}`)
  }

  if (options.help) return options

  const httpConfigured = Boolean(options.serverUrl || options.downloadUrl || options.uploadUrl)
  if (httpConfigured) {
    if (sshTargetProvided) {
      throw new Error("HTTP 测速和 SSH 测速不能同时指定")
    }

    const endpoints = resolveEndpointUrls(options)
    return {
      ...options,
      ...endpoints,
      mode: "http",
      sizeBytes: Math.max(1, Math.round(options.sizeMb * 1024 * 1024)),
    }
  }

  return {
    ...options,
    mode: "ssh",
    sizeBytes: Math.max(1, Math.round(options.sizeMb * 1024 * 1024)),
  }
}

function addRequestParameters(endpoint, bytes) {
  const url = new URL(endpoint)
  url.searchParams.set("bytes", String(bytes))
  url.searchParams.set("cacheBust", `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  return url.toString()
}

async function withTimeout(timeoutMs, task) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await task(controller.signal)
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`请求超过 ${timeoutMs}ms 未完成`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function* randomChunks(totalBytes) {
  let remaining = totalBytes
  while (remaining > 0) {
    const chunkSize = Math.min(remaining, RANDOM_CHUNK_BYTES)
    yield randomBytes(chunkSize)
    remaining -= chunkSize
  }
}

async function createPayloadFile(filePath, bytes) {
  await pipeline(
    Readable.from(randomChunks(bytes)),
    createWriteStream(filePath),
  )
}

async function measureDownload({ endpoint, bytes, timeoutMs, fetchImpl = fetch }) {
  const startedAt = performance.now()
  let receivedBytes = 0

  await withTimeout(timeoutMs, async (signal) => {
    const response = await fetchImpl(addRequestParameters(endpoint, bytes), {
      method: "GET",
      headers: {
        "accept-encoding": "identity",
        "cache-control": "no-store",
      },
      signal,
    })

    if (!response.ok) {
      throw new Error(`下载端点返回 HTTP ${response.status}`)
    }
    if (!response.body) {
      throw new Error("下载端点没有返回响应体")
    }

    await pipeline(Readable.fromWeb(response.body), new Writable({
      write(chunk, _encoding, callback) {
        receivedBytes += chunk.length
        callback()
      },
    }))
  })

  if (receivedBytes !== bytes) {
    throw new Error(`下载数据量不符：收到 ${receivedBytes} 字节，预期 ${bytes} 字节`)
  }

  return {
    bytes: receivedBytes,
    elapsedMs: Math.max(1, performance.now() - startedAt),
  }
}

async function measureUpload({ endpoint, bytes, timeoutMs, filePath, fetchImpl = fetch }) {
  const startedAt = performance.now()
  const body = createReadStream(filePath)

  try {
    await withTimeout(timeoutMs, async (signal) => {
      const response = await fetchImpl(addRequestParameters(endpoint, bytes), {
        method: "POST",
        headers: {
          "accept-encoding": "identity",
          "cache-control": "no-store",
          "content-length": String(bytes),
          "content-type": "application/octet-stream",
        },
        body,
        duplex: "half",
        signal,
      })

      if (!response.ok) {
        throw new Error(`上传端点返回 HTTP ${response.status}`)
      }

      if (response.body) {
        await pipeline(Readable.fromWeb(response.body), new Writable({
          write(_chunk, _encoding, callback) {
            callback()
          },
        }))
      }
    })
  } finally {
    body.destroy()
  }

  return {
    bytes,
    elapsedMs: Math.max(1, performance.now() - startedAt),
  }
}

function buildSshRemoteCommand(direction, bytes) {
  if (direction === "upload") {
    return "dd of=/dev/null bs=1048576 status=none"
  }

  const fullBlocks = Math.floor(bytes / RANDOM_CHUNK_BYTES)
  const remainder = bytes % RANDOM_CHUNK_BYTES
  const commands = []
  if (fullBlocks > 0) {
    commands.push(`dd if=/dev/zero bs=${RANDOM_CHUNK_BYTES} count=${fullBlocks} status=none`)
  }
  if (remainder > 0) {
    commands.push(`dd if=/dev/zero bs=${remainder} count=1 status=none`)
  }
  return commands.join(" && ")
}

function buildSshArgs(target, direction, bytes) {
  return [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "Compression=no",
    "-o",
    "LogLevel=ERROR",
    target,
    buildSshRemoteCommand(direction, bytes),
  ]
}

function formatSshError(stderr) {
  const message = stderr
    .split("\n")
    .filter((line) => line && !line.startsWith("** WARNING:"))
    .join("\n")
    .trim()
  return message || "SSH 进程失败"
}

async function measureSshTransfer({ target, direction, bytes, timeoutMs, spawnImpl = defaultSpawn }) {
  const child = spawnImpl("ssh", buildSshArgs(target, direction, bytes), {
    stdio: ["pipe", "pipe", "pipe"],
  })
  const startedAt = performance.now()
  let transferredBytes = 0
  let stderr = ""

  child.stderr.on("data", (chunk) => {
    if (stderr.length < 2_048) stderr += chunk.toString()
  })

  const exitPromise = new Promise((resolve, reject) => {
    let settled = false
    child.once("error", (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.once("close", (code, signal) => {
      if (settled) return
      settled = true
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${formatSshError(stderr)} (code=${code ?? "none"}, signal=${signal ?? "none"})`))
      }
    })
  })

  const transferPromise = direction === "download"
    ? pipeline(child.stdout, new Writable({
      write(chunk, _encoding, callback) {
        transferredBytes += chunk.length
        callback()
      },
    }))
    : pipeline(Readable.from(randomChunks(bytes)), child.stdin)

  if (direction === "download") {
    child.stdin.end()
  }

  let forceKillTimer
  try {
    await withTimeout(timeoutMs, async (signal) => {
      const abortChild = () => {
        child.kill("SIGTERM")
        forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 500)
      }
      signal.addEventListener("abort", abortChild, { once: true })
      try {
        await Promise.all([transferPromise, exitPromise])
      } finally {
        signal.removeEventListener("abort", abortChild)
      }
    })
  } finally {
    if (forceKillTimer) clearTimeout(forceKillTimer)
    if (child.exitCode === null && !child.killed) child.kill("SIGTERM")
  }

  if (direction === "download" && transferredBytes !== bytes) {
    throw new Error(`SSH 下载数据量不符：收到 ${transferredBytes} 字节，预期 ${bytes} 字节`)
  }

  return {
    bytes: direction === "download" ? transferredBytes : bytes,
    elapsedMs: Math.max(1, performance.now() - startedAt),
  }
}

function bytesToMbps(bytes, elapsedMs) {
  return (bytes * 8) / (elapsedMs * 1_000)
}

function aggregateSpeeds(rounds) {
  const downloadSpeeds = rounds.map((round) => round.downloadMbps).sort((a, b) => a - b)
  const uploadSpeeds = rounds.map((round) => round.uploadMbps).sort((a, b) => a - b)
  const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length
  const median = (values) => {
    const middle = Math.floor(values.length / 2)
    return values.length % 2 === 0
      ? (values[middle - 1] + values[middle]) / 2
      : values[middle]
  }

  return {
    averageDownloadMbps: average(downloadSpeeds),
    averageUploadMbps: average(uploadSpeeds),
    medianDownloadMbps: median(downloadSpeeds),
    medianUploadMbps: median(uploadSpeeds),
  }
}

function buildSpeedTestResult(options, rounds, failures, extra = {}) {
  if (rounds.length === 0) {
    const reason = failures.map((failure) => `第 ${failure.round} 轮：${failure.message}`).join("；")
    throw new Error(`所有测速轮次均失败。${reason}`)
  }

  return {
    ...extra,
    requestedRounds: options.rounds,
    sizeBytes: options.sizeBytes,
    rounds,
    failures,
    summary: aggregateSpeeds(rounds),
  }
}

async function runHttpSpeedTest(options, { fetchImpl = fetch, tempRoot = tmpdir() } = {}) {
  const tempDir = await mkdtemp(join(tempRoot, "synapse-speedtest-"))
  const uploadFilePath = join(tempDir, "upload.bin")
  const rounds = []
  const failures = []

  try {
    await createPayloadFile(uploadFilePath, options.sizeBytes)

    for (let round = 1; round <= options.rounds; round += 1) {
      try {
        const download = await measureDownload({
          endpoint: options.downloadUrl,
          bytes: options.sizeBytes,
          timeoutMs: options.timeoutMs,
          fetchImpl,
        })
        const upload = await measureUpload({
          endpoint: options.uploadUrl,
          bytes: options.sizeBytes,
          timeoutMs: options.timeoutMs,
          filePath: uploadFilePath,
          fetchImpl,
        })

        rounds.push({
          round,
          downloadMbps: bytesToMbps(download.bytes, download.elapsedMs),
          uploadMbps: bytesToMbps(upload.bytes, upload.elapsedMs),
        })
      } catch (error) {
        failures.push({
          round,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return buildSpeedTestResult(options, rounds, failures, {
      mode: "http",
      downloadUrl: options.downloadUrl,
      uploadUrl: options.uploadUrl,
    })
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function runSshSpeedTest(options, { spawnImpl = defaultSpawn } = {}) {
  const rounds = []
  const failures = []

  for (let round = 1; round <= options.rounds; round += 1) {
    try {
      const download = await measureSshTransfer({
        target: options.sshTarget,
        direction: "download",
        bytes: options.sizeBytes,
        timeoutMs: options.timeoutMs,
        spawnImpl,
      })
      const upload = await measureSshTransfer({
        target: options.sshTarget,
        direction: "upload",
        bytes: options.sizeBytes,
        timeoutMs: options.timeoutMs,
        spawnImpl,
      })

      rounds.push({
        round,
        downloadMbps: bytesToMbps(download.bytes, download.elapsedMs),
        uploadMbps: bytesToMbps(upload.bytes, upload.elapsedMs),
      })
    } catch (error) {
      failures.push({
        round,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return buildSpeedTestResult(options, rounds, failures, {
    mode: "ssh",
    sshTarget: options.sshTarget,
  })
}

async function runSpeedTest(options, dependencies = {}) {
  if (options.mode === "ssh") {
    return runSshSpeedTest(options, dependencies)
  }

  return runHttpSpeedTest(options, dependencies)
}

function formatMbps(value) {
  return `${value.toFixed(2)} Mbps`
}

function displayEndpoint(endpoint) {
  const url = new URL(endpoint)
  return `${url.origin}${url.pathname}`
}

function printHelp() {
  console.log(`用法：pnpm speedtest [选项]

默认通过 SSH 连接部署脚本中的生产服务器：
  ${DEFAULT_SSH_TARGET}

HTTP 模式（传入 --server 或显式端点）要求服务器提供：
  GET  <服务器地址>/speedtest/download?bytes=N  返回恰好 N 字节
  POST <服务器地址>/speedtest/upload?bytes=N    接收原始请求体并返回 2xx

选项：
  --ssh-target <user@host>  SSH 测速目标，可用 SYNAPSE_SPEEDTEST_SSH_TARGET
  --server, --url <url>       服务器基地址，也可用 SYNAPSE_SPEEDTEST_SERVER
  --download-url <url>       下载端点，可用 SYNAPSE_SPEEDTEST_DOWNLOAD_URL
  --upload-url <url>         上传端点，可用 SYNAPSE_SPEEDTEST_UPLOAD_URL
  --rounds <n>               测试轮数，默认 ${DEFAULT_ROUNDS}，最多 ${MAX_ROUNDS}
  --size-mb <n>              每轮数据量，默认 ${DEFAULT_SIZE_MB} MB，最多 ${MAX_SIZE_MB} MB
  --timeout-ms <n>           单次请求超时，默认 ${DEFAULT_TIMEOUT_MS} ms
  -h, --help                显示帮助`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  const result = await runSpeedTest(options)
  if (result.mode === "ssh") {
    console.log(`SSH 测速目标：${result.sshTarget}`)
  } else {
    console.log(`测速下载端点：${displayEndpoint(result.downloadUrl)}`)
    console.log(`测速上传端点：${displayEndpoint(result.uploadUrl)}`)
  }
  console.log(`数据量：${(result.sizeBytes / (1024 * 1024)).toFixed(2)} MB，成功 ${result.rounds.length}/${result.requestedRounds} 轮`)

  for (const round of result.rounds) {
    console.log(`第 ${round.round} 轮：下载 ${formatMbps(round.downloadMbps)}，上传 ${formatMbps(round.uploadMbps)}`)
  }
  for (const failure of result.failures) {
    console.error(`第 ${failure.round} 轮失败：${failure.message}`)
  }

  console.log(`平均速度：下载 ${formatMbps(result.summary.averageDownloadMbps)}，上传 ${formatMbps(result.summary.averageUploadMbps)}`)
  console.log(`中位数：下载 ${formatMbps(result.summary.medianDownloadMbps)}，上传 ${formatMbps(result.summary.medianUploadMbps)}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

export {
  aggregateSpeeds,
  bytesToMbps,
  parseArgs,
  runSpeedTest,
}
