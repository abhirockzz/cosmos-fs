# Configuration

The CLI reads settings from flags, then environment variables, then a config file,
in that order. A flag always wins over the environment.

## Config file

Nimbus looks for `~/.nimbus/config.toml`:

```toml
region = "us-west"
default_bucket = "my-first-bucket"
timeout_seconds = 30
```

## Environment variables

| Variable | Meaning |
| --- | --- |
| `NIMBUS_TOKEN` | API key or OAuth access token. |
| `NIMBUS_REGION` | Default region for new buckets. |
| `NIMBUS_TIMEOUT` | Per-request timeout in seconds. |

## Regions

Buckets live in one region and cannot move. Pick the region closest to your users
to keep latency low. Available regions are `us-west`, `us-east`, and `eu-central`.
