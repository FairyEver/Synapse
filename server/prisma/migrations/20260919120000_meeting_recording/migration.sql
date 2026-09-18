-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(32) NOT NULL DEFAULT 'transcribing',
    "speakerCount" INTEGER NOT NULL DEFAULT 0,
    "failureReason" VARCHAR(1000),
    "minutesStatus" VARCHAR(32) NOT NULL DEFAULT 'none',
    "minutesJson" JSONB,
    "minutesFailureReason" VARCHAR(1000),
    "minutesEditedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingRecording" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" VARCHAR(128) NOT NULL DEFAULT 'audio/mp4',
    "size" BIGINT NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "peaks" TEXT,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "deletedAt" TIMESTAMP(3),
    "deletePending" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingTranscriptionJob" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "engineModelType" VARCHAR(64) NOT NULL DEFAULT '16k_zh_en_meeting',
    "parameters" JSONB,
    "taskId" VARCHAR(64),
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "uploadId" TEXT,
    "totalBytes" BIGINT NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" VARCHAR(1000),
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingTranscriptionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingUploadPart" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "partNumber" INTEGER NOT NULL,
    "etag" VARCHAR(128) NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingUploadPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingTranscriptSegment" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "segmentIndex" INTEGER NOT NULL,
    "speakerId" INTEGER NOT NULL DEFAULT 0,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "words" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingTranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingSpeaker" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "speakerId" INTEGER NOT NULL,
    "name" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingSpeaker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Meeting_userId_startedAt_idx" ON "Meeting"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "Meeting_status_updatedAt_idx" ON "Meeting"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Meeting_userId_status_createdAt_idx" ON "Meeting"("userId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingRecording_meetingId_key" ON "MeetingRecording"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingRecording_storageKey_key" ON "MeetingRecording"("storageKey");

-- CreateIndex
CREATE INDEX "MeetingRecording_status_createdAt_idx" ON "MeetingRecording"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MeetingRecording_deletePending_updatedAt_idx" ON "MeetingRecording"("deletePending", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingTranscriptionJob_meetingId_key" ON "MeetingTranscriptionJob"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingTranscriptionJob_status_updatedAt_idx" ON "MeetingTranscriptionJob"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "MeetingTranscriptionJob_status_expiresAt_idx" ON "MeetingTranscriptionJob"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "MeetingUploadPart_jobId_idx" ON "MeetingUploadPart"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingUploadPart_jobId_partNumber_key" ON "MeetingUploadPart"("jobId", "partNumber");

-- CreateIndex
CREATE INDEX "MeetingTranscriptSegment_meetingId_startMs_idx" ON "MeetingTranscriptSegment"("meetingId", "startMs");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingTranscriptSegment_meetingId_segmentIndex_key" ON "MeetingTranscriptSegment"("meetingId", "segmentIndex");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingSpeaker_meetingId_speakerId_key" ON "MeetingSpeaker"("meetingId", "speakerId");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingRecording" ADD CONSTRAINT "MeetingRecording_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingTranscriptionJob" ADD CONSTRAINT "MeetingTranscriptionJob_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingUploadPart" ADD CONSTRAINT "MeetingUploadPart_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MeetingTranscriptionJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingTranscriptSegment" ADD CONSTRAINT "MeetingTranscriptSegment_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingSpeaker" ADD CONSTRAINT "MeetingSpeaker_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

