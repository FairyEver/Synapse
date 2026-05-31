ALTER TABLE "DesktopLoginCode" ADD COLUMN "clientId" TEXT NOT NULL DEFAULT 'synapse-desktop';
ALTER TABLE "DesktopLoginCode" ALTER COLUMN "clientId" DROP DEFAULT;

ALTER TABLE "DesktopLoginCode" ADD COLUMN "redirectUri" TEXT NOT NULL DEFAULT 'synapse://auth/desktop/callback';
ALTER TABLE "DesktopLoginCode" ALTER COLUMN "redirectUri" DROP DEFAULT;

ALTER TABLE "DesktopLoginCode" ADD COLUMN "codeChallenge" TEXT NOT NULL DEFAULT 'legacy-code-challenge';
ALTER TABLE "DesktopLoginCode" ALTER COLUMN "codeChallenge" DROP DEFAULT;

ALTER TABLE "DesktopLoginCode" ADD COLUMN "codeChallengeMethod" TEXT NOT NULL DEFAULT 'S256';
ALTER TABLE "DesktopLoginCode" ALTER COLUMN "codeChallengeMethod" DROP DEFAULT;
