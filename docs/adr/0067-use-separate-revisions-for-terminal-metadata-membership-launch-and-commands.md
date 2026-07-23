# Use separate revisions for Terminal metadata, membership, launch, and commands

Terminal management uses narrow optimistic-concurrency revisions rather than one revision that conflicts on unrelated changes.

- Session `metadataRevision` controls display and affiliation metadata such as rename. `session.rename` requires `expectedMetadataRevision`; an actual change advances metadata and state revisions, while a normalized equal value is a no-op. Any future move also advances session metadata and the source and destination membership revisions.
- `groupRevision` is the overall group-object revision. Rename requires `expectedGroupRevision` and advances only the overall revision, not launch semantics.
- `launchRevision` controls cwd, shell, environment, and other launch semantics. Settings update requires `expectedLaunchRevision`; an actual semantic change advances both launch and overall group revisions.
- `membershipRevision` controls the member set. Direct creation, deletion, and future explicit movement advance membership and overall group revisions. Names, launch settings, output, and session state do not advance it.
- `commandCollectionRevision` controls command collection reads, delete plans, and authorization decisions. Command creation requires `expectedCommandCollectionRevision`. Every command create or delete and every individual update that can affect those semantics advances collection and overall group revisions.
- Individual `commandRevision` provides exact update and delete conflict control. A successful update advances the command, collection, and group revisions; deletion advances collection and group revisions. Semantic change invalidates launch grants pinned to the old command revision.

Every management operation has a caller-scoped idempotency key and returns `operationId`, before and after revisions, and `changed` or `no-op`. Conflicts are explicit and never automatically merged. Audit records field categories, revisions, and results without command bodies, cwd, environment values, or other sensitive content.
