#!/bin/sh
# Install t3-coordinator without cloning the git repo.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/DecisionNerd/t3-coordinator/main/scripts/install.sh | sh
#
# Env overrides:
#   T3_COORDINATOR_REF          git ref (default: main) — tag like v0.1.0 also works via archive
#   T3_COORDINATOR_INSTALL_DIR  app dir (default: $HOME/.t3-coordinator/app)
#   T3_COORDINATOR_BIN_DIR      bin dir (default: $HOME/.local/bin)
#   T3_COORDINATOR_REPO         owner/name (default: DecisionNerd/t3-coordinator)

set -eu

REPO="${T3_COORDINATOR_REPO:-DecisionNerd/t3-coordinator}"
REF="${T3_COORDINATOR_REF:-main}"
INSTALL_DIR="${T3_COORDINATOR_INSTALL_DIR:-${HOME}/.t3-coordinator/app}"
BIN_DIR="${T3_COORDINATOR_BIN_DIR:-${HOME}/.local/bin}"
TMP_DIR="${TMPDIR:-/tmp}/t3-coordinator-install-$$"

say() { printf '%s\n' "$*"; }
err() { printf 't3-coordinator install: %s\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || err "missing required command: $1"
}

need_cmd curl
need_cmd tar
need_cmd node
need_cmd npm

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "Node.js 20+ required (found $(node -v))"
fi

ARCHIVE_URL="https://github.com/${REPO}/archive/refs/heads/${REF}.tar.gz"
# Prefer tag archives when REF looks like a version tag.
case "$REF" in
  v[0-9]*|[0-9]*.[0-9]*)
    ARCHIVE_URL="https://github.com/${REPO}/archive/refs/tags/${REF}.tar.gz"
    ;;
esac

say "Downloading ${REPO}@${REF}…"
mkdir -p "$TMP_DIR"
curl -fsSL "$ARCHIVE_URL" -o "$TMP_DIR/src.tar.gz" || err "download failed: $ARCHIVE_URL"

say "Extracting to ${INSTALL_DIR}…"
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
tar -xzf "$TMP_DIR/src.tar.gz" -C "$TMP_DIR"
EXTRACTED="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
# Copy contents (not the wrapper folder name) into INSTALL_DIR.
# shellcheck disable=SC2046
cp -R "$EXTRACTED"/. "$INSTALL_DIR"/

say "Installing npm dependencies…"
cd "$INSTALL_DIR"
npm install

say "Building TypeScript…"
npm run build

say "Pruning devDependencies…"
npm prune --omit=dev

mkdir -p "$BIN_DIR"
WRAPPER="$BIN_DIR/t3-coordinator"
cat > "$WRAPPER" <<EOF
#!/bin/sh
exec node "${INSTALL_DIR}/lib/cli.js" "\$@"
EOF
chmod +x "$WRAPPER"

# Record install metadata for doctor / upgrades.
mkdir -p "${HOME}/.t3-coordinator"
cat > "${HOME}/.t3-coordinator/install.json" <<EOF
{
  "repo": "${REPO}",
  "ref": "${REF}",
  "installDir": "${INSTALL_DIR}",
  "bin": "${WRAPPER}",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

rm -rf "$TMP_DIR"

say ""
say "Registering MCP on supervisor providers (Codex/Cursor)…"
if command -v node >/dev/null 2>&1 && [ -f "${INSTALL_DIR}/lib/cli.js" ]; then
  node "${INSTALL_DIR}/lib/cli.js" ensure-mcp || say "ensure-mcp reported an issue — run: t3-coordinator ensure-mcp"
else
  say "Skip ensure-mcp (bin not ready) — run: t3-coordinator ensure-mcp"
fi

say ""
say "Installed t3-coordinator."
say "  app:  ${INSTALL_DIR}"
say "  bin:  ${WRAPPER}"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    say ""
    say "Add to PATH (zsh/bash):"
    say "  export PATH=\"${BIN_DIR}:\$PATH\""
    ;;
esac
if ! command -v temporal >/dev/null 2>&1; then
  say ""
  say "Temporal CLI not found. On OVHC/Linux:"
  say "  curl -sSf https://temporal.download/cli.sh | sh"
  say "  # or: brew install temporal"
fi
say ""
say "Next:"
say "  t3-coordinator doctor"
say "  t3-coordinator auth-issue"
say "  t3-coordinator start"
say "  # Open a NEW T3 chat — MCP tools should appear (ensure-mcp already ran)"
say ""
say "Optional — sticky mailbox thread (assign/push can also pass supervisorThreadId and auto-bind):"
say "  t3-coordinator bind-supervisor --environment env-local --thread <supervisorThreadId>"
say ""
say "Optional — personalize how you prepare specs (no reinstall):"
say "  cp ${INSTALL_DIR}/templates/operating-profile.default.json ~/.t3-coordinator/operating-profile.json"
say "  # docs: Customize your workflow"
say ""
say "Add a project checkout as a T3 project (suggested first: DecisionNerd/dev-skills)."
say "Quick start: https://github.com/DecisionNerd/t3-coordinator/blob/main/docs/experience/QUICKSTART.md"
