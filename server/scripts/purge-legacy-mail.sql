-- One-time production cutover. Run only after database and mail-object backups are verified
-- and mail writes are paused. Mail objects remain in the durable deletion queue until
-- the mail cleanup worker removes each object successfully.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "MailMessage" WHERE "conversationId" <> "id")
     OR EXISTS (SELECT 1 FROM "MailSendPreview" WHERE "formatVersion" >= 2) THEN
    RAISE EXCEPTION 'New-format mail exists; legacy purge must run before reopening mail writes';
  END IF;
END $$;

INSERT INTO "MailStorageDeletion" ("id", "storageKey", "createdAt")
SELECT "storageKey", "storageKey", NOW() FROM "MailAttachment"
ON CONFLICT ("storageKey") DO NOTHING;

DELETE FROM "UserNotification" WHERE "source" = 'mail';
DELETE FROM "MailSendPreview";
DELETE FROM "MailMessage";
DELETE FROM "MailAttachment";

COMMIT;

SELECT
  (SELECT COUNT(*) FROM "MailMessage") AS messages,
  (SELECT COUNT(*) FROM "MailRecipient") AS recipients,
  (SELECT COUNT(*) FROM "MailSendPreview") AS previews,
  (SELECT COUNT(*) FROM "MailAttachment") AS attachments,
  (SELECT COUNT(*) FROM "MailNotificationOutbox") AS notification_outbox,
  (SELECT COUNT(*) FROM "UserNotification" WHERE "source" = 'mail') AS mail_notifications,
  (SELECT COUNT(*) FROM "MailStorageDeletion") AS pending_object_deletions;
