# Exclude problem-feedback content from all first-party backups

Problem feedback has no disaster-recovery guarantee. Its strict 180-day retention boundary applies to recoverable first-party copies as well as the live database. Every first-party scheduled, manual, deployment, rollback backup and export excludes `ProblemFeedback` table data while retaining its schema and migrations. Official infrastructure must not create snapshots that contain the table data when that data cannot be excluded. Restores therefore do not restore feedback records.

Self-hosted operators are responsible for external backups and must run expiry cleanup before allowing administrators to read a restored database; startup cleanup remains a defense in depth for such restores and legacy copies. Administrator security audits contain no feedback body and continue under the existing audit-retention policy rather than the 180-day feedback-content policy.
