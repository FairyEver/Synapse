import { MEETING_PART_BYTES } from "@synapse/shared"

/**
 * 边录边传的分片拼装。
 *
 * 编码器每 2 秒给一坨字节，攒够 `MEETING_PART_BYTES` 才真的传走一片——那是一 MB，
 * 同时也是对象存储分块上传的最小分片，约合 128 秒音频。所以一场会议只会产生几十个
 * 分片，而不是上千个。
 *
 * 结束录音时只需要补齐最后一片，这也是「完成」是瞬间的原因：不管录了五分钟还是
 * 三小时，收尾的工作量都一样。
 *
 * 三条不变量：
 * - **分片必须按编号顺序传**。服务端会拒绝跳号，因为那意味着中间缺一段，而缺一段的
 *   音频既不会报错也不会听起来明显。
 * - **同一时刻只有一次在传**。并发会让编号和服务端的写入顺序对不上。
 * - **取消要走中止**，不是删除：未完成的分块上传留在桶里的分片，删对象删不掉。
 */

export type ChunkUploaderDeps = {
  /** 传一个分片。失败要抛出，由这里决定是重试还是整体失败。 */
  readonly uploadPart: (partNumber: number, bytes: ArrayBuffer) => Promise<void>
  /** 取消这次录音：中止分块上传并丢弃已传分片。 */
  readonly abort: () => Promise<void>
  readonly partBytes?: number
  /** 传片失败时的重试次数。 */
  readonly retries?: number
}

export type ChunkUploader = {
  readonly bufferedBytes: number
  readonly uploadedParts: number
  /** 收下一坨编码器交出来的字节，攒够了就会传走。 */
  append(bytes: ArrayBuffer): Promise<void>
  /** 补齐尾片。返回之后所有字节都已经被服务端确认。 */
  finish(): Promise<void>
  /** 中止：丢掉缓冲，并且**中止**已经开始的这次分块上传。 */
  cancel(): Promise<void>
  readonly hasPendingTail: boolean
}

const DEFAULT_RETRIES = 3

export function createChunkUploader(deps: ChunkUploaderDeps): ChunkUploader {
  const partBytes = deps.partBytes ?? MEETING_PART_BYTES
  const retries = deps.retries ?? DEFAULT_RETRIES
  let buffer = new Uint8Array(0)
  let uploadedParts = 0
  let cancelled = false
  /** 把并发调用串成一条链：分片编号是按这条链的先后分配的。 */
  let chain: Promise<void> = Promise.resolve()

  function enqueue(task: () => Promise<void>): Promise<void> {
    chain = chain.then(task, task)
    return chain
  }

  async function sendPart(bytes: Uint8Array): Promise<void> {
    const partNumber = uploadedParts + 1
    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        // 拷一份再发：缓冲区随后会被复用，直接把底层 ArrayBuffer 交出去会让服务端
        // 拿到正在被改写的字节。
        await deps.uploadPart(partNumber, bytes.slice().buffer as ArrayBuffer)
        uploadedParts += 1
        return
      } catch (error) {
        lastError = error
      }
    }
    throw lastError instanceof Error ? lastError : new Error("分片上传失败。")
  }

  async function drain(force: boolean): Promise<void> {
    if (cancelled) return
    while (buffer.byteLength >= partBytes || (force && buffer.byteLength > 0)) {
      const size = force && buffer.byteLength < partBytes ? buffer.byteLength : partBytes
      const part = buffer.subarray(0, size)
      await sendPart(part)
      // 传成功之后才从缓冲里切掉。先切后传的话，失败重试会丢掉这一片。
      buffer = buffer.subarray(size)
    }
  }

  return {
    get bufferedBytes() {
      return buffer.byteLength
    },
    get uploadedParts() {
      return uploadedParts
    },
    get hasPendingTail() {
      return buffer.byteLength > 0
    },
    append(bytes: ArrayBuffer) {
      return enqueue(async () => {
        if (cancelled) return
        const merged = new Uint8Array(buffer.byteLength + bytes.byteLength)
        merged.set(buffer, 0)
        merged.set(new Uint8Array(bytes), buffer.byteLength)
        buffer = merged
        await drain(false)
      })
    },
    finish() {
      return enqueue(async () => {
        if (cancelled) return
        await drain(true)
      })
    },
    async cancel() {
      cancelled = true
      buffer = new Uint8Array(0)
      // 等前面的传片跑完，否则中止可能赶在某一片写入之前发生，那一片就成了桶里的碎片。
      await chain.catch(() => undefined)
      await deps.abort()
    },
  }
}
