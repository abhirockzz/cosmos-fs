# Authentication

Nimbus supports two ways to authenticate: API keys for scripts and single users,
and OAuth 2.0 for applications acting on behalf of many users.

## API keys

Create a key and pass it as a bearer token:

```bash
nimbus key create --name ci-uploader
export NIMBUS_TOKEN=nk_live_...
```

Keys do not expire, so rotate them regularly and scope each key to the buckets it
needs. A leaked key can read and write every bucket it is allowed to touch.

## OAuth 2.0

For apps that act for many users, use the authorization-code flow. Nimbus issues a
short-lived access token and a refresh token. Access tokens expire after one hour;
refresh before they lapse to avoid a 401 on the next call.

## Common failures

A missing or wrong token returns `401 Unauthorized`. A valid token without access
to the target bucket returns `403 Forbidden`. See [Error codes](../reference/errors.md).
