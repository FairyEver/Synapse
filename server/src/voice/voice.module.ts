import { Module } from "@nestjs/common"

import { UserAuthModule } from "../auth/user-auth.module"
import { createVoiceConfig, voiceConfigToken } from "./voice.config"
import { VoiceController } from "./voice.controller"
import { VoiceService } from "./voice.service"

@Module({
  imports: [UserAuthModule],
  controllers: [VoiceController],
  providers: [
    VoiceService,
    { provide: voiceConfigToken, useFactory: createVoiceConfig },
  ],
})
export class VoiceModule {}
