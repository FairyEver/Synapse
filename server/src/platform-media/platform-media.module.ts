import { Module } from "@nestjs/common"
import { PlatformMediaStorage } from "../drive/platform-media-storage"

@Module({ providers: [PlatformMediaStorage], exports: [PlatformMediaStorage] })
export class PlatformMediaModule {}
