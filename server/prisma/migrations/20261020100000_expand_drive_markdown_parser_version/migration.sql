-- Parser identities include normalization and table-layout revisions.
ALTER TABLE "DriveMarkdownProjection"
  ALTER COLUMN "parserVersion" TYPE VARCHAR(128);
