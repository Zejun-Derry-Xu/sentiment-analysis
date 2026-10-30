#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
docker compose --profile tools run --rm tests
npm ci
npm run build
