#!/usr/bin/env bash
# Idempotent provisioning for cosmos-fs, via Azure CLI (control plane / ARM).
#
# Why az CLI and not the SDK: provisioning is infrastructure, so it belongs on the
# control plane, keeping the app's data-plane code focused on reading/serving items.
# `disableLocalAuth=true` on the account only blocks data-plane key auth; these ARM
# calls authenticate with your Azure AD token from `az login`, so they work fine.
#
# Requires: `az login` with control-plane rights on the account. Safe to re-run
# (each resource is created only if absent).
set -euo pipefail

# Required: your Cosmos DB account and its resource group.
ACCOUNT="${COSMOS_ACCOUNT:-}"
RESOURCE_GROUP="${COSMOS_RG:-}"
# Optional: sensible defaults for a fresh corpus.
DATABASE="${COSMOS_DATABASE:-docs}"
CONTAINER="${COSMOS_CONTAINER:-pages}"
PARTITION_KEY="${COSMOS_PK:-/namespace}"
THROUGHPUT="${COSMOS_THROUGHPUT:-1000}"
IDX_FILE="$(cd "$(dirname "$0")" && pwd)/cosmos-indexing-policy.json"
# Full-text policy makes `grep -w` index-accelerated (see PLAN.md Phase 9). It is
# immutable — set only at container creation — and needs az CLI >= 2.87 for the
# --full-text-policy flag.
FT_FILE="$(cd "$(dirname "$0")" && pwd)/cosmos-fulltext-policy.json"

if [[ -z "$ACCOUNT" || -z "$RESOURCE_GROUP" ]]; then
  echo "Set COSMOS_ACCOUNT and COSMOS_RG to your Cosmos DB account and its resource group." >&2
  echo "Example: COSMOS_ACCOUNT=my-account COSMOS_RG=my-rg ./scripts/provision.sh" >&2
  exit 1
fi

echo "Account=$ACCOUNT  RG=$RESOURCE_GROUP  DB=$DATABASE  Container=$CONTAINER  PK=$PARTITION_KEY  RU/s=$THROUGHPUT"

if [[ "$(az cosmosdb sql database exists -a "$ACCOUNT" -g "$RESOURCE_GROUP" -n "$DATABASE" -o tsv)" == "true" ]]; then
  echo "database '$DATABASE' already exists — skipping"
else
  az cosmosdb sql database create -a "$ACCOUNT" -g "$RESOURCE_GROUP" -n "$DATABASE" --only-show-errors -o none
  echo "created database '$DATABASE'"
fi

if [[ "$(az cosmosdb sql container exists -a "$ACCOUNT" -g "$RESOURCE_GROUP" -d "$DATABASE" -n "$CONTAINER" -o tsv)" == "true" ]]; then
  echo "container '$CONTAINER' already exists — skipping (full-text index is set only at creation; recreate to add it)"
else
  az cosmosdb sql container create \
    -a "$ACCOUNT" -g "$RESOURCE_GROUP" -d "$DATABASE" -n "$CONTAINER" \
    --partition-key-path "$PARTITION_KEY" \
    --throughput "$THROUGHPUT" \
    --idx "@$IDX_FILE" \
    --full-text-policy "@$FT_FILE" \
    --only-show-errors -o none
  echo "created container '$CONTAINER' (full-text index on /content)"
fi

echo "== container summary =="
az cosmosdb sql container show \
  -a "$ACCOUNT" -g "$RESOURCE_GROUP" -d "$DATABASE" -n "$CONTAINER" \
  --query "{id:resource.id, partitionKey:resource.partitionKey, indexingMode:resource.indexingPolicy.indexingMode, excludedPaths:resource.indexingPolicy.excludedPaths, fullTextPaths:resource.fullTextPolicy.fullTextPaths}" \
  -o json
