#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then
  umask 077
  python3 - <<'PY'
from pathlib import Path
import secrets
example=Path('.env.example').read_text()
Path('.env').write_text(example.replace('replace-with-a-local-random-value',secrets.token_hex(24)))
PY
fi
docker compose up -d --build
echo 'Campus Notes: http://localhost:5180 (unless APP_PORT was changed). First model download may take a few minutes.'
