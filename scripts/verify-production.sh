#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 https://flexi.example.com"
  exit 1
fi

BASE_URL="${1%/}"

check() {
  local path="$1"
  local expected="$2"
  local url="${BASE_URL}${path}"

  echo "==> ${url}"
  response="$(curl -sS -o /tmp/flexi-verify-body.$$ -w '%{http_code}' "${url}")"
  if [[ "${response}" != "${expected}" ]]; then
    echo "Unexpected status for ${url}: got ${response}, expected ${expected}"
    cat /tmp/flexi-verify-body.$$ || true
    rm -f /tmp/flexi-verify-body.$$
    exit 1
  fi
  rm -f /tmp/flexi-verify-body.$$
}

check "/healthz" "200"
check "/.well-known/oauth-authorization-server" "200"
check "/login" "200"
check "/legal/privacy" "200"
check "/legal/terms" "200"
check "/support" "200"

echo "Production HTTP checks passed for ${BASE_URL}"
