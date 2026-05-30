#!/usr/bin/env bash
set -euo pipefail

run() {
  echo
  echo "==> $*"
  "$@"
}

run npm run typecheck
run npm test
run npm run build
run npm run smoke:service
run npm run demo:manual-pilot
run npm run demo:pilot
run npm run status:mmdx:preflight

echo
echo "==> npm run status:mmdx:dry-run"
dry_run_file="$(mktemp)"
cleanup() {
  rm -f "$dry_run_file"
}
trap cleanup EXIT

npm run --silent status:mmdx:dry-run >"$dry_run_file"
node - "$dry_run_file" <<'NODE'
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log(`MMDX dry-run OK: ${payload.url}`);
console.log(`source_sha256=${payload.source_sha256}`);
NODE

echo
echo "Local bounty proof passed."
echo "Live Instagram delivery and public Buildooor publish still require external credentials/auth."
