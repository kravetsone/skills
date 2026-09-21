# Backlog — <project>

Dependency-ordered. Sizes are S / M / L, three buckets — finer estimates at
planning time are false precision.

Ordering rules:

1. Foundation first: config, database, migrations, health, auth, telemetry.
2. Then the entities other things depend on.
3. Then features, ordered by Figma `devStatus` — screens marked ready-for-dev
   are what the team intends to ship first, which beats a guess at priority.
4. Cross-cutting concerns (rate limiting, admin panel) after the domain is stable.

**Every H-### gets its own row, and that row includes the concurrency test.**
Not "implement purchase" but "implement purchase with the H-003 test". A guard
with no test is a guard that will be refactored away by someone who does not
know why it is there.

| ID | Task | Depends on | Size | Requirement | Hotspot |
| --- | --- | --- | --- | --- | --- |
| T-001 | Bootstrap: config, db client, migrations, `GET /health` | — | S | — | — |
| T-002 | Telemetry: OTel exporters, span naming, `/health` excluded | T-001 | S | — | — |
| T-003 | Auth plugin (init-data validation), 401/403 split | T-001 | M | | — |
| T-004 | | | | | |

## Infrastructure tasks

Easy to forget, and each one blocks somebody for a day.

| ID | Task | Lead time | Blocks |
| --- | --- | --- | --- |
| I-001 | Add sealed secret `<NAME>` to `.k8s` and to CI `SECRETS` | hours–days | |
| I-002 | Enable `POSTGRES_ENABLED` / `REDIS_ENABLED` / `MINIO_ENABLED` in the pipeline | hours | |
| I-003 | Create the S3 bucket and add it to `MINIO_BUCKETS` | hours | |
| I-004 | Register the Telegram webhook against the deployed domain | minutes | |
| I-005 | Create the staging analytics project and issue its own key | minutes | |

## Not in this scope

<Stated explicitly, so the omission reads as a decision rather than an oversight.>
