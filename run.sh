#!/usr/bin/env bash
# Run the MorphoNup website on the lab workstation. Open http://localhost:8000 (VS Code forwards the port over SSH).
#   bash run.sh            build the page (a few seconds), then serve it
# The site is static, as on GitHub Pages: the models run in the browser, no Python server is needed. Stop with Ctrl+C.
set -e
SITE="$(dirname "$(readlink -f "$0")")"
ENVS="$(readlink -f "$SITE/../../envs")"
export PATH="$ENVS/web/bin:$PATH"
cd "$SITE/frontend"
[ -d node_modules ] || npm install --no-audit --no-fund
npm run build            # always: dist/ may hold a GitHub Pages build (npm run build:pages), made for /MorphoNup-Web/
echo "MorphoNup: http://localhost:${PORT:-8000}"
exec npx vite preview --host 127.0.0.1 --port "${PORT:-8000}" --strictPort
