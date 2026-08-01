# Let only active admin users read problem feedback

Superseded by ADR-0212.

V1 problem-feedback records are readable only by active `AdminUser` sessions accepted by the existing `AdminAuthGuard`, with equal access for every active administrator. Dashboard users, team owners, desktop users, and anonymous submitters receive no read capability, and the feature exposes no public list, per-ID read endpoint, or share link. V1 does not add premature administrator RBAC; finer administrator duties require a separate future design if the administrator population expands.
