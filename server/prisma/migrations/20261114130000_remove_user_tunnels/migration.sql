-- Permanent removal of the retired port mapping feature and its dedicated data.
-- Run through the deployment backup and restore rehearsal before production.
-- Restoring the previous application alone cannot recover these records.
BEGIN;
DROP TABLE "UserTunnelOperation";
DROP TABLE "TunnelDeviceCredential";
DROP TABLE "UserTunnel";
COMMIT;
