#!/bin/bash

# Standard paranoia.
set -euo pipefail

echo "Building selectstar..."
npm run build

#echo "Fetching master npm token from vault..."
#NPM_TOKEN="$(vault read --field=auth secret/services/npm/token)"
#echo -n "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > .npmrc

echo "Publishing to npm..."
npm publish

echo "Deleting npm token..."
rm .npmrc

echo "Done!"
