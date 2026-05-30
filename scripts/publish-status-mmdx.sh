#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-dry-run}"
shift || true

STATUS_STACK="${STATUS_STACK:-diagrams/inschneidergram-project-status.mmdx}"
BUILDOOOR_USERNAME="${BUILDOOOR_USERNAME:-buildooor}"
BUILDOOOR_SLUG="${BUILDOOOR_SLUG:-mmdx-inschneidergram-project-status}"
BUILDOOOR_TITLE="${BUILDOOOR_TITLE:-Inschneidergram Project Status}"
SPAPS_SERVER_URL="${SPAPS_SERVER_URL:-https://api.sweetpotato.dev}"
SPAPS_CLIENT_ID="${SPAPS_CLIENT_ID:-buildooor}"

resolve_mmd_cli() {
  if [[ -n "${MMDX_CLI:-}" ]]; then
    printf '%s\n' "$MMDX_CLI"
    return
  fi

  local candidate
  for candidate in \
    "../opensource/skills/mmdx/scripts/mmd.py" \
    "$HOME/repos/opensource/skills/mmdx/scripts/mmd.py"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return
    fi
  done

  echo "Could not find mmd.py. Set MMDX_CLI=/path/to/mmd.py." >&2
  exit 1
}

resolve_spaps_cmd() {
  if [[ -n "${SPAPS_CMD:-}" ]]; then
    printf '%s\n' "$SPAPS_CMD"
    return
  fi

  if command -v spaps >/dev/null 2>&1; then
    printf '%s\n' "spaps"
    return
  fi

  local candidate
  for candidate in \
    "../sweet-potato/packages/spaps/bin/spaps.js" \
    "$HOME/repos/sweet-potato/packages/spaps/bin/spaps.js"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "node $candidate"
      return
    fi
  done

  echo "Could not find spaps. Set SPAPS_CMD='spaps' or 'node /path/to/spaps.js'." >&2
  exit 1
}

MMDX_CLI_RESOLVED="$(resolve_mmd_cli)"
SPAPS_CMD_RESOLVED="$(resolve_spaps_cmd)"
TOKEN_CMD="$SPAPS_CMD_RESOLVED token --server-url $SPAPS_SERVER_URL"

case "$MODE" in
  preflight)
    python3 "$MMDX_CLI_RESOLVED" "$STATUS_STACK" --preflight-only "$@"
    ;;
  fragment)
    python3 "$MMDX_CLI_RESOLVED" "$STATUS_STACK" --fragment-only --no-preflight "$@"
    ;;
  dry-run)
    python3 "$MMDX_CLI_RESOLVED" publish-link "$STATUS_STACK" \
      --username "$BUILDOOOR_USERNAME" \
      --slug "$BUILDOOOR_SLUG" \
      --title "$BUILDOOOR_TITLE" \
      --dry-run \
      "$@"
    ;;
  list)
    python3 "$MMDX_CLI_RESOLVED" list \
      --access-token-command "$TOKEN_CMD" \
      --json \
      "$@"
    ;;
  login)
    $SPAPS_CMD_RESOLVED login \
      --server-url "$SPAPS_SERVER_URL" \
      --client-id "$SPAPS_CLIENT_ID" \
      "$@"
    ;;
  publish)
    python3 "$MMDX_CLI_RESOLVED" publish-link "$STATUS_STACK" \
      --username "$BUILDOOOR_USERNAME" \
      --slug "$BUILDOOOR_SLUG" \
      --title "$BUILDOOOR_TITLE" \
      --access-token-command "$TOKEN_CMD" \
      "$@"
    ;;
  *)
    cat >&2 <<'USAGE'
Usage: scripts/publish-status-mmdx.sh <mode>

Modes:
  preflight  Validate diagrams/inschneidergram-project-status.mmdx.
  dry-run    Show the Buildooor app-link payload and source hash.
  list       List owned Buildooor MMDX diagrams using SPAPS auth.
  login      Start SPAPS device-code login for client_id=buildooor.
  publish    Publish to BUILDOOOR_USERNAME/BUILDOOOR_SLUG and verify live.
  fragment   Print the pako fragment for manual browser opening.

Env:
  MMDX_CLI=/path/to/mmd.py
  SPAPS_CMD='spaps' or 'node /path/to/spaps.js'
  BUILDOOOR_SLUG=mmdx-inschneidergram-project-status
  SPAPS_SERVER_URL=https://api.sweetpotato.dev
USAGE
    exit 2
    ;;
esac
