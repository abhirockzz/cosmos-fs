# Setup and prerequisites

One-time setup that every quickstart assumes: an Azure Cosmos DB for NoSQL account,
a signed-in Azure session with data-plane access, and the `cosmos-fs` binary on your
PATH.

You only do this once. After it, jump to a quickstart:

- [Index your own docs](01-index-your-docs.md): load a local folder and explore it.
- [Explore an existing container](02-map-existing.md): point cosmos-fs at data you already have.
- [Use cosmos-fs as an AI agent tool](03-agent-tool.md): wire it into an agent loop.

## Prerequisites

- **Node.js 20+** and **pnpm** (`npm install -g pnpm`).
- **Azure CLI** (`az`), version 2.87 or newer (the quickstarts provision a full-text index
  for `grep -w`). See [Install the Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli).
- An **Azure Cosmos DB for NoSQL account**. If you don't have one, create it with the
  [portal quickstart](https://learn.microsoft.com/azure/cosmos-db/quickstart-portal#create-an-account)
  (pick the **API for NoSQL**). Note the account's **URI**, for example
  `https://my-account.documents.azure.com:443/`.

## 1. Sign in to Azure

cosmos-fs authenticates with Microsoft Entra ID through `DefaultAzureCredential`, which
picks up your Azure CLI session. No account keys are stored or used.

```bash
az login
az account set --subscription "<your-subscription>"   # if you have more than one
```

See [Sign in with the Azure CLI](https://learn.microsoft.com/cli/azure/authenticate-azure-cli).

## 2. Grant yourself data-plane access

Control-plane roles like Owner do **not** grant permission to read or write data in
Cosmos DB. You need a separate **data-plane** role assignment. cosmos-fs provides two
built-in roles that fit:

- **Cosmos DB Built-in Data Reader** (`00000000-0000-0000-0000-000000000001`) is enough
  if you only ever *explore*.
- **Cosmos DB Built-in Data Contributor** (`00000000-0000-0000-0000-000000000002`) also
  allows `cosmos-fs ingest` to write. Use this one to run every quickstart.

Assign it to your own identity, scoped to the whole account:

```bash
ACCOUNT="<your-account-name>"
RESOURCE_GROUP="<your-resource-group>"
PRINCIPAL_ID=$(az ad signed-in-user show --query id -o tsv)

az cosmosdb sql role assignment create \
  --resource-group "$RESOURCE_GROUP" \
  --account-name "$ACCOUNT" \
  --role-definition-id "00000000-0000-0000-0000-000000000002" \
  --principal-id "$PRINCIPAL_ID" \
  --scope "/"
```

For the full picture (custom roles, other identities), see
[Grant data-plane role-based access](https://learn.microsoft.com/azure/cosmos-db/how-to-connect-role-based-access-control#grant-data-plane-role-based-access)
and the [built-in role reference](https://learn.microsoft.com/azure/cosmos-db/reference-data-plane-security#built-in-roles).

## 3. Install cosmos-fs

cosmos-fs is not published to npm yet, so build it from source and link it onto your PATH:

```bash
git clone https://github.com/your-org/cosmos-fs.git
cd cosmos-fs
pnpm install
pnpm build      # compiles the binary to dist/cli.js
npm link        # puts `cosmos-fs` on your PATH
```

Verify:

```bash
cosmos-fs --version
```

```
cosmos-fs 0.0.1
```

## 4. Point cosmos-fs at your account

cosmos-fs reads its target from environment variables, a `.env` file, or flags (flags win).
Copy the template and set your account URI:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
COSMOS_ENDPOINT=https://<your-account>.documents.azure.com:443/
COSMOS_DATABASE=docs        # default; any database name
COSMOS_CONTAINER=pages      # default; any container name
# COSMOS_FS_NAMESPACE is set per document set in each quickstart.
```

Only `COSMOS_ENDPOINT` is required; `COSMOS_DATABASE` and `COSMOS_CONTAINER` default to
`docs` and `pages`. `cosmos-fs --help` lists every setting.

## Troubleshooting

- **`Hint: sign in with az login and ensure you have Cosmos data-plane RBAC.`** The account
  is reachable but your identity lacks a data-plane role. Redo step 2. Role assignments can
  take a short while to propagate.
- **`Missing Cosmos endpoint`** No `COSMOS_ENDPOINT` was found. Set it in `.env` or pass
  `--endpoint`.
- **`az login` opens no browser** Use `az login --use-device-code`.

Next: [Index your own docs](01-index-your-docs.md).
