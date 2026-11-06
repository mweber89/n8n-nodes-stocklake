#!/usr/bin/env bash
# Builds the package and starts a throwaway n8n that loads the built dist/.
# Everything n8n stores (database, credentials, workflows) lives in
# ./.n8n-dev, which is git-ignored and safe to delete.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export N8N_USER_FOLDER="${N8N_USER_FOLDER:-$repo/.n8n-dev}"
custom="$N8N_USER_FOLDER/.n8n/custom/n8n-nodes-stocklake"

cd "$repo"
npm run build

# n8n scans ~/.n8n/custom for *.node.js and *.credentials.js. Copy (not symlink)
# dist/ so its layout, which the credential icon paths depend on, is kept as is.
mkdir -p "$custom"
rsync -a --delete "$repo/dist/" "$custom/"

echo "Loaded $(find "$custom" -name '*.node.js' | wc -l) node file(s) from $custom"
exec npx --yes n8n start
