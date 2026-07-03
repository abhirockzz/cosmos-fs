# FAQ

## Is there a free tier?

Yes. The free tier includes one bucket and 5 GB of storage. Upgrade for more
buckets, more storage, and a higher rate limit.

## Can I move a bucket to another region?

No. A bucket's region is fixed when you create it. To change regions, create a new
bucket in the target region and copy objects across.

## Why am I getting 429 errors?

You are sending requests faster than your plan's rate limit allows. The CLI
retries with backoff; if you need sustained higher throughput, request a quota
increase. See [Error codes](reference/errors.md).

## Do API keys expire?

API keys do not expire. OAuth access tokens expire after one hour. Rotate API keys
regularly and scope them narrowly.
