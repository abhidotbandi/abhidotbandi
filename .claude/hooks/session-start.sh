#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# 1. Installs npm dependencies so lint, typecheck and `next build` work.
# 2. Makes the preinstalled headless Chromium trust the session's egress proxy, so
#    Playwright can load HTTPS pages (for example Vercel preview deployments, opened
#    with the VERCEL_AUTOMATION_BYPASS_SECRET environment variable). curl, node and
#    python already trust the proxy through SSL_CERT_FILE / NODE_EXTRA_CA_CERTS;
#    Chromium only reads its NSS store at ~/.pki/nssdb, which starts out empty.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

npm install --no-audit --no-fund --loglevel=error 1>&2
echo "session-start: npm dependencies installed"

# Best effort: a failure here must not block the session.
trust_session_cas() {
  local sources=()
  [ -f /root/.ccr/agent-proxy-ca.crt ] && sources+=(/root/.ccr/agent-proxy-ca.crt)
  for f in /usr/local/share/ca-certificates/*.crt; do
    [ -f "$f" ] && sources+=("$f")
  done
  if [ ${#sources[@]} -eq 0 ]; then
    echo "session-start: no session CA certificates found; browser trust unchanged"
    return 0
  fi

  if ! command -v certutil >/dev/null 2>&1; then
    { apt-get install -y -q libnss3-tools || { apt-get update -q && apt-get install -y -q libnss3-tools; }; } >/dev/null 2>&1 || {
      echo "session-start: could not install certutil; headless Chromium won't trust the proxy" >&2
      return 0
    }
  fi

  local db="$HOME/.pki/nssdb"
  mkdir -p "$db"
  [ -f "$db/cert9.db" ] || certutil -d "sql:$db" -N --empty-password

  # Files can hold several certificates and certutil imports only the first, so split
  # them, then import each distinct certificate once, named by its fingerprint.
  local tmp added=0 seen=" "
  tmp=$(mktemp -d)
  for f in "${sources[@]}"; do
    awk -v out="$tmp/$(basename "$f" .crt)" '/BEGIN CERTIFICATE/ { i++ } i { print > (out "-" i ".pem") }' "$f"
  done
  for pem in "$tmp"/*.pem; do
    local fp name
    fp=$(openssl x509 -in "$pem" -noout -fingerprint -sha256 2>/dev/null | sed 's/.*=//; s/://g') || continue
    [ -n "$fp" ] || continue
    case "$seen" in *" $fp "*) continue ;; esac
    seen="$seen$fp "
    name="session-ca-${fp:0:16}"
    if certutil -d "sql:$db" -L -n "$name" >/dev/null 2>&1; then
      certutil -d "sql:$db" -M -n "$name" -t "C,," || true
    else
      certutil -d "sql:$db" -A -n "$name" -t "C,," -i "$pem" || true
    fi
    added=$((added + 1))
  done
  rm -rf "$tmp"
  echo "session-start: headless Chromium trusts $added session CA certificate(s)"
}

trust_session_cas || echo "session-start: browser CA setup skipped after an error" >&2
