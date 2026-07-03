# Error codes

Nimbus returns standard HTTP status codes. The body carries a JSON `error` object
with a `code` and a human-readable `message`.

## 401 Unauthorized

The token is missing, malformed, or expired. Create or refresh a token (see
[Authentication](../guide/authentication.md)).

## 403 Forbidden

The token is valid but lacks access to the bucket. Grant the key access or use a
key scoped to that bucket.

## 404 Not Found

The bucket or object key does not exist. Check the name and region; a bucket in
`us-west` is not visible from `us-east`.

## 429 Too Many Requests

You exceeded the rate limit. Back off and retry; the CLI does this for you with
exponential backoff. Sustained throughput above the limit needs a quota increase.

## 500 Internal Server Error

A server-side failure. Retry once; if it persists, the status page has details.
