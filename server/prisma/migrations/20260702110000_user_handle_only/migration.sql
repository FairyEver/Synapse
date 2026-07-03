DO $$
DECLARE
  user_record RECORD;
  base_handle TEXT;
  candidate TEXT;
  suffix INTEGER;
  reserved_names TEXT[] := ARRAY[
    'api',
    'console',
    'files',
    'share',
    'sites',
    'webhooks',
    'con',
    'prn',
    'aux',
    'nul',
    'com1',
    'com2',
    'com3',
    'com4',
    'com5',
    'com6',
    'com7',
    'com8',
    'com9',
    'lpt1',
    'lpt2',
    'lpt3',
    'lpt4',
    'lpt5',
    'lpt6',
    'lpt7',
    'lpt8',
    'lpt9'
  ];
BEGIN
  FOR user_record IN
    SELECT id, email
    FROM "User"
    WHERE "handle" IS NULL
    ORDER BY "createdAt" ASC, id ASC
  LOOP
    base_handle := lower(split_part(user_record.email, '@', 1));
    base_handle := regexp_replace(base_handle, '[^a-z0-9-]+', '-', 'g');
    base_handle := regexp_replace(base_handle, '-+', '-', 'g');
    base_handle := regexp_replace(base_handle, '(^-+|-+$)', '', 'g');
    base_handle := left(base_handle, 54);

    IF base_handle = '' THEN
      base_handle := 'user';
    END IF;

    IF base_handle = ANY(reserved_names) THEN
      base_handle := left(base_handle, 49) || '-user';
    END IF;

    suffix := 0;
    LOOP
      IF suffix = 0 THEN
        candidate := base_handle;
      ELSE
        candidate := left(base_handle, 64 - length('-' || suffix::TEXT)) || '-' || suffix::TEXT;
      END IF;

      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM "User" WHERE "handle" = candidate
      ) AND NOT EXISTS (
        SELECT 1 FROM "UserHandleRedirect" WHERE "oldHandle" = candidate
      );

      suffix := suffix + 1;
    END LOOP;

    UPDATE "User"
    SET "handle" = candidate
    WHERE id = user_record.id;
  END LOOP;
END $$;

ALTER TABLE "User" ALTER COLUMN "handle" SET NOT NULL;
ALTER TABLE "User" DROP COLUMN "displayName";
