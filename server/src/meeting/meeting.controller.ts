import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import type { MeetingMinutesDto } from "@synapse/shared"
import type { Response } from "express"
import { z } from "zod"

import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { badRequestFromZodError } from "../common/zod-validation"
import { MEETING_UPLOAD_RATE_LIMIT_PER_MINUTE, RATE_LIMIT_TTL_MS } from "../common/rate-limits"
import { LocalMeetingStorage } from "./meeting-storage.service"
import { MeetingService } from "./meeting.service"

/**
 * 会议记录。
 *
 * 分片走服务端代理而不是客户端直传对象存储：现在的 SDK 只能在整文件级别签出读写
 * 地址，签不了单个分片。音频过一次服务端按 28 MB/小时算可以忽略，换来的是客户端
 * 从头到尾不持有任何存储凭证。
 */

const startSchema = z
  .object({
    title: z.string().trim().max(255).optional(),
    startedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()

const finalizeSchema = z
  .object({
    durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
    peaks: z.string().max(4 * 1024 * 1024),
    speakerCount: z.number().int().min(0).max(1000),
  })
  .strict()

const renameSchema = z.object({ title: z.string().trim().min(1).max(255) }).strict()

const speakerSchema = z.object({ name: z.string().trim().max(64).nullable() }).strict()

const todoSchema = z
  .object({
    id: z.string().min(1).max(64),
    text: z.string().trim().min(1).max(2000),
    owner: z.string().trim().max(64).nullable(),
    due: z.string().trim().max(64).nullable(),
    done: z.boolean(),
  })
  .strict()

const minutesSchema = z
  .object({
    topics: z.array(z.string().trim().min(1).max(2000)).max(200),
    conclusions: z.array(z.string().trim().min(1).max(2000)).max(200),
    todos: z.array(todoSchema).max(200),
    editedAt: z.string().nullable(),
  })
  .strict()

function parseBody<T extends z.ZodType>(schema: T, body: unknown, message: string): z.infer<T> {
  const result = schema.safeParse(body)
  if (!result.success) throw badRequestFromZodError(result.error, message)
  return result.data
}

@Controller("/api/meetings")
@UseGuards(UserAuthGuard)
export class MeetingController {
  constructor(
    private readonly meetings: MeetingService,
    private readonly localStorage: LocalMeetingStorage,
  ) {}

  @Get()
  list(@Req() request: AuthenticatedUserRequest) {
    return this.meetings.list(request.user!.id)
  }

  /** 上次没收尾的录音。没有就返回 null，不报错。 */
  @Get("/recordings/pending")
  findPendingRecording(@Req() request: AuthenticatedUserRequest) {
    return this.meetings.findPendingRecording(request.user!.id)
  }

  /**
   * 本地回退时的音频读取入口。
   *
   * 只有在没配对象存储的部署里才存在——那条路上腾讯云本来也够不到本机，所以它主要
   * 服务于开发和自建部署。令牌一次一签、落盘带过期时间。
   */
  @Get("/local-audio/:token")
  async localAudio(@Param("token") token: string, @Res() response: Response): Promise<void> {
    if (!/^[A-Za-z0-9_-]{8,128}$/u.test(token)) throw new BadRequestException("音频地址无效。")
    const key = await this.localStorage.resolveDownloadToken(token)
    if (!key) throw new BadRequestException("音频地址已失效。")
    const { stream, size } = await this.localStorage.getObjectStream(key)
    response.setHeader("Content-Type", "audio/mp4")
    if (size !== undefined) response.setHeader("Content-Length", size.toString())
    stream.pipe(response)
  }

  @Get("/:meetingId")
  get(@Req() request: AuthenticatedUserRequest, @Param("meetingId") meetingId: string) {
    return this.meetings.get(request.user!.id, meetingId)
  }

  @Post("/recordings")
  @HttpCode(HttpStatus.CREATED)
  start(@Req() request: AuthenticatedUserRequest, @Body() body: unknown) {
    return this.meetings.startRecording(request.user!.id, parseBody(startSchema, body, "录音参数无效。"))
  }

  /**
   * 接收一个分片。
   *
   * 分片是裸字节，不套 multipart 表单：客户端直接 PUT 一个 1 MB 的 Buffer，服务端
   * 原样转给对象存储，中间不做任何解析。
   */
  @Throttle({ default: { ttl: RATE_LIMIT_TTL_MS, limit: MEETING_UPLOAD_RATE_LIMIT_PER_MINUTE } })
  @Put("/recordings/:recordingId/parts/:partNumber")
  @HttpCode(HttpStatus.OK)
  async uploadPart(
    @Req() request: AuthenticatedUserRequest,
    @Param("recordingId") recordingId: string,
    @Param("partNumber") partNumber: string,
  ) {
    const body = await readRawBody(request)
    return this.meetings.acceptPart(request.user!.id, recordingId, Number(partNumber), body)
  }

  /** 完成录音。合并与提交都在这里收口，客户端拿到响应就可以回列表了。 */
  @Post("/recordings/:recordingId/complete")
  @HttpCode(HttpStatus.OK)
  complete(
    @Req() request: AuthenticatedUserRequest,
    @Param("recordingId") recordingId: string,
    @Body() body: unknown,
  ) {
    return this.meetings.completeRecording(
      request.user!.id,
      recordingId,
      parseBody(finalizeSchema, body, "录音信息无效。"),
    )
  }

  /** 取消录音。服务端会**中止**这次分块上传，已传分片一并丢弃。 */
  @Delete("/recordings/:recordingId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancel(@Req() request: AuthenticatedUserRequest, @Param("recordingId") recordingId: string) {
    await this.meetings.cancelRecording(request.user!.id, recordingId)
  }

  @Patch("/:meetingId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async rename(@Req() request: AuthenticatedUserRequest, @Param("meetingId") meetingId: string, @Body() body: unknown) {
    await this.meetings.rename(request.user!.id, meetingId, parseBody(renameSchema, body, "名称无效。").title)
  }

  @Put("/:meetingId/speakers/:speakerId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async nameSpeaker(
    @Req() request: AuthenticatedUserRequest,
    @Param("meetingId") meetingId: string,
    @Param("speakerId") speakerId: string,
    @Body() body: unknown,
  ) {
    const parsed = parseBody(speakerSchema, body, "发言人名称无效。")
    await this.meetings.nameSpeaker(request.user!.id, meetingId, Number(speakerId), parsed.name)
  }

  /** 删除录音本身，逐字稿和纪要保留。 */
  @Delete("/:meetingId/recording")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRecording(@Req() request: AuthenticatedUserRequest, @Param("meetingId") meetingId: string) {
    await this.meetings.deleteRecording(request.user!.id, meetingId)
  }

  @Post("/:meetingId/transcription/retry")
  @HttpCode(HttpStatus.NO_CONTENT)
  async retryTranscription(@Req() request: AuthenticatedUserRequest, @Param("meetingId") meetingId: string) {
    await this.meetings.retryTranscription(request.user!.id, meetingId)
  }

  @Put("/:meetingId/minutes")
  @HttpCode(HttpStatus.NO_CONTENT)
  async saveMinutes(
    @Req() request: AuthenticatedUserRequest,
    @Param("meetingId") meetingId: string,
    @Body() body: unknown,
  ) {
    const parsed = parseBody(minutesSchema, body, "纪要内容无效。") as MeetingMinutesDto
    await this.meetings.saveMinutes(request.user!.id, meetingId, parsed)
  }

  @Get("/:meetingId/audio-url")
  async audioUrl(@Req() request: AuthenticatedUserRequest, @Param("meetingId") meetingId: string) {
    return this.meetings.createPlaybackUrl(request.user!.id, meetingId)
  }

  @Get("/:meetingId/peaks")
  async peaks(@Req() request: AuthenticatedUserRequest, @Param("meetingId") meetingId: string) {
    return this.meetings.readPeaks(request.user!.id, meetingId)
  }
}

/**
 * 一个分片的字节上限。
 *
 * 正常分片是 1 MB；这里给到 8 MB 是留出客户端把最后一片攒大一点的余地，同时把内
 * 存占用钉死——没有这条，一个乱来的客户端可以让我们把整段录音读进内存。
 */
const MAX_PART_BYTES = 8 * 1024 * 1024

/**
 * 读原始请求体。
 *
 * 分片是二进制，不能用 `@Body()`——那条路已经被 JSON body parser 接管了，1 MB 的
 * m4a 字节进去会变成一坨解析失败的对象。所以直接消费请求流，读到上限就掐断。
 */
async function readRawBody(request: AuthenticatedUserRequest): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer)
    total += buffer.byteLength
    if (total > MAX_PART_BYTES) throw new BadRequestException("分片过大。")
    chunks.push(buffer)
  }
  if (total === 0) throw new BadRequestException("分片内容为空。")
  return Buffer.concat(chunks)
}
