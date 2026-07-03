# CLI reference

Every command takes `--region` and `--token` to override configuration.

## bucket

```
nimbus bucket create <name> [--region <region>]
nimbus bucket list
nimbus bucket delete <name>
```

## put

Upload a local file to a bucket.

```
nimbus put <bucket> <file> [--key <object-key>]
```

If `--key` is omitted, the file name is used as the object key.

## get

Download an object to stdout or a file.

```
nimbus get <bucket> <object-key> [--output <file>]
```

## Rate limits

The CLI retries a `429 Too Many Requests` automatically with exponential backoff,
up to five attempts. Raise `NIMBUS_TIMEOUT` if large uploads hit the timeout.
