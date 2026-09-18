import { Module } from "@nestjs/common"

import { UserAuthModule } from "../auth/user-auth.module"
import { LiveModule } from "../live/live.module"
import { MobileLiveModule } from "../mobile-live/mobile-live.module"
import { createMeetingConfig, meetingConfigToken } from "./meeting.config"
import { MeetingController } from "./meeting.controller"
import {
  CosMeetingStorage,
  LOCAL_MEETING_STORAGE_OPTIONS,
  LocalMeetingStorage,
  MEETING_COS_OPTIONS,
  MEETING_STORAGE_PORT,
  readLocalMeetingStorageOptions,
  readMeetingCosOptionsIfConfigured,
  shouldUseCosMeetingStorage,
} from "./meeting-storage.service"
import { MeetingService } from "./meeting.service"
import { MeetingTranscriptionService } from "./meeting-transcription.service"

/**
 * 会议记录。
 *
 * 存储走端口 + 运行时工厂：配了对象存储就用分块上传，没配就回退本地盘。两种实现的
 * 中止语义必须一致——中止要丢弃分片，而不是删掉合并后的对象。
 *
 * 这里**一行环境变量都不能读**：Nest 的模块装饰器在文件被导入时就求值，任何在这里
 * 读 env 的写法都会让「只是 import 一下 AppModule」（测试、脚本、任何工具）变成一次
 * 可能抛错的副作用。所有 env 读取都放进 useFactory，等真正实例化依赖时才跑。
 */
@Module({
  imports: [UserAuthModule, LiveModule, MobileLiveModule],
  controllers: [MeetingController],
  providers: [
    MeetingService,
    MeetingTranscriptionService,
    CosMeetingStorage,
    LocalMeetingStorage,
    {
      provide: MEETING_STORAGE_PORT,
      useFactory: (cos: CosMeetingStorage, local: LocalMeetingStorage) =>
        shouldUseCosMeetingStorage() ? cos : local,
      inject: [CosMeetingStorage, LocalMeetingStorage],
    },
    { provide: MEETING_COS_OPTIONS, useFactory: readMeetingCosOptionsIfConfigured },
    { provide: LOCAL_MEETING_STORAGE_OPTIONS, useFactory: readLocalMeetingStorageOptions },
    { provide: meetingConfigToken, useFactory: createMeetingConfig },
  ],
  exports: [MeetingService, MeetingTranscriptionService],
})
export class MeetingModule {}
