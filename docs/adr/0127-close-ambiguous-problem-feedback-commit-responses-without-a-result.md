# Close ambiguous problem-feedback commit responses without a result

If PostgreSQL may have received `COMMIT` but the connection fails before confirmation, the server must not fabricate a determinate HTTP `503` and must not add a server-side unknown JSON result. It terminates or leaves the structured response incomplete, causing the desktop to classify the interrupted response as `SUBMISSION_OUTCOME_UNKNOWN`. The strict `503 { "code": "SUBMISSION_FAILED" }` is reserved for cases where the server can prove that the transaction did not commit.
