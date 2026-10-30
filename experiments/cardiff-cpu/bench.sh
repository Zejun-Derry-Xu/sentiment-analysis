#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -f .env ]; then sh start.sh; fi
if [ "$#" -eq 0 ]; then set -- all; fi
docker compose --env-file .env --profile tools run --rm client python run.py "$@"
