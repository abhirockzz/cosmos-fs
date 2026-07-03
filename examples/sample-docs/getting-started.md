# Getting started with Nimbus

Nimbus is a small object-storage API. You upload files to a bucket and read them
back over HTTPS. This page gets you from zero to your first upload.

## Install the CLI

```bash
npm install -g nimbus-cli
nimbus --version
```

## Make your first request

Create a bucket, then upload a file:

```bash
nimbus bucket create my-first-bucket --region us-west
nimbus put my-first-bucket ./photo.jpg
```

Every request needs an API key. See [Authentication](guide/authentication.md) for
how to create one and how to switch to OAuth for multi-user setups.

## Where to next

- [Configuration](guide/configuration.md) to set defaults like the region.
- [CLI reference](reference/cli.md) for the full command list.
- [Error codes](reference/errors.md) when a request fails.
