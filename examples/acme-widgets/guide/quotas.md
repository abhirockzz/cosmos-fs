# Quotas

Acme Widgets enforces per-plan quotas. Exceeding a quota returns `429 Too Many Requests`;
back off and retry, or upgrade the plan.

| Plan | Widgets | Variants per widget |
| --- | --- | --- |
| Sandbox (free) | 50 | 10 |
| Team | 5,000 | 100 |
| Enterprise | unlimited | unlimited |

The sandbox is for testing only. Widgets created in the sandbox are not visible in
production and are purged after 30 days.
