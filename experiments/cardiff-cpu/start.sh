#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  python3 - <<'PY'
from pathlib import Path
import platform,subprocess,json
cpu=platform.processor() or platform.machine()
if platform.system()=='Darwin':
    cpu=subprocess.check_output(['sysctl','-n','machdep.cpu.brand_string'],text=True).strip()
elif Path('/proc/cpuinfo').exists():
    candidates=[x.split(':',1)[1].strip() for x in Path('/proc/cpuinfo').read_text().splitlines() if x.lower().startswith('model name')]
    if candidates:cpu=candidates[0]
label=f'{cpu} / host {platform.system()} {platform.machine()} / Docker CPU trial'
Path('.env').write_text('HOST_LABEL='+json.dumps(label)+'\nCARDIFF_PORT=5181\nCARDIFF_BIND=127.0.0.1\n')
PY
fi
docker compose --env-file .env up -d --build --wait
echo 'Cardiff CPU trial: http://localhost:5181 (unless CARDIFF_PORT was changed).'
