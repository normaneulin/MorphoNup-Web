#!/usr/bin/env bash
# Run the MorphoNup website on the lab workstation. Open http://localhost:8000 (VS Code forwards the port over SSH).
#   bash run.sh            build the page if it was never built, then start the server
#   bash run.sh --build    rebuild the page first (after changing anything in frontend/)
# Stop with Ctrl+C. The server predicts on the CPU only, so it never takes GPU memory from training.
set -e
SITE="$(dirname "$(readlink -f "$0")")"
ENVS="$(readlink -f "$SITE/../../envs")"
if [ ! -f "$SITE/frontend/dist/index.html" ] || [ "${1:-}" = "--build" ]; then
  (cd "$SITE/frontend" && PATH="$ENVS/web/bin:$PATH" npm install --no-audit --no-fund && PATH="$ENVS/web/bin:$PATH" npm run build)
fi
cd "$SITE/backend"
echo "MorphoNup: http://localhost:${PORT:-8000}"
exec "$ENVS/web-api/bin/uvicorn" morphonup_web.app:app --host 127.0.0.1 --port "${PORT:-8000}"
