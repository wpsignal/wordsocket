#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# svn.sh: Commit a built WordSocket release to WordPress.org SVN
#
# Prerequisites:
#   - Run `npm run dist` first (produces dist/wordsocket.zip and dist/svn-assets/)
#   - SVN checkout at $SVN_DIR (default: ../wordsocket-svn, relative to plugin root)
#
# Usage:
#   npm run svn
#   SVN_USERNAME=yourname npm run svn
#   SVN_DIR=/path/to/wordsocket-svn npm run svn
#
# What it does:
#   1. Syncs dist/wordsocket.zip contents to SVN trunk/
#   2. Syncs dist/svn-assets/ to SVN assets/ (if present)
#   3. Tags the release: svn cp trunk/ tags/{version}/
#   4. Stages new/deleted files and commits
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PLUGIN_DIR"

# ── Helpers ──────────────────────────────────────────────────────────────────
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
info()  { printf '  \033[34m→\033[0m %s\n' "$*"; }
ok()    { printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn()  { printf '  \033[33m⚠\033[0m %s\n' "$*"; }
die()   { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# ── Config ────────────────────────────────────────────────────────────────────
VERSION="$(node -p "require('./package.json').version")"
PLUGIN_SLUG="wordsocket"
SVN_DIR="${SVN_DIR:-$PLUGIN_DIR/../wordsocket-svn}"
SVN_DIR="$(cd "$SVN_DIR" && pwd)"
ZIP="$PLUGIN_DIR/dist/${PLUGIN_SLUG}.zip"
SVN_ASSETS_SRC="$PLUGIN_DIR/dist/svn-assets"

# Optional SVN username (SVN will prompt if not set)
SVN_USER_FLAG=()
if [[ -n "${SVN_USERNAME:-}" ]]; then
  SVN_USER_FLAG=(--username "$SVN_USERNAME")
fi

bold "WordSocket SVN: v${VERSION}"
echo ""

# ── Preflight ─────────────────────────────────────────────────────────────────
info "Checking prerequisites"

[[ -f "$ZIP" ]]      || die "dist/wordsocket.zip not found. Run 'npm run dist' first."
[[ -d "$SVN_DIR" ]]  || die "SVN directory not found: $SVN_DIR"
command -v svn &>/dev/null || die "svn is not installed. Run: brew install subversion"

info "Updating SVN checkout"
(cd "$SVN_DIR" && svn update)

# Check remote for existing tag (local checkout may be stale)
if svn list "https://plugins.svn.wordpress.org/wordsocket/tags/$VERSION" &>/dev/null; then
  die "Tag $VERSION already exists in SVN. Bump the version before releasing."
fi

ok "Prerequisites met (zip exists, SVN dir found, tag is new)"

# ── 1. Sync trunk ─────────────────────────────────────────────────────────────
echo ""
bold "Syncing trunk"

info "Clearing trunk/ contents"
# Delete contents but keep the directory — SVN tracks the directory itself
find "$SVN_DIR/trunk" -mindepth 1 -delete
mkdir -p "$SVN_DIR/trunk"

info "Unzipping dist/${PLUGIN_SLUG}.zip into trunk/"
unzip -q "$ZIP" -d /tmp/wps-svn-stage
cp -r /tmp/wps-svn-stage/"$PLUGIN_SLUG"/. "$SVN_DIR/trunk/"
rm -rf /tmp/wps-svn-stage
# Belt-and-suspenders: strip anything that should never reach wp.org
rm -rf "$SVN_DIR/trunk/vendor"
ok "trunk/ updated"

# ── 2. Sync SVN assets ────────────────────────────────────────────────────────
echo ""
bold "Syncing assets"

if [[ -d "$SVN_ASSETS_SRC" ]]; then
  mkdir -p "$SVN_DIR/assets"
  cp -r "$SVN_ASSETS_SRC"/. "$SVN_DIR/assets/"
  ok "assets/ updated from dist/svn-assets/"
else
  warn "No dist/svn-assets/ found — skipping assets/ sync."
  warn "Icons and banners will not be updated."
fi

# ── 3. Stage new and deleted files ────────────────────────────────────────────
echo ""
bold "Staging SVN changes"
cd "$SVN_DIR"

# Add all new/unversioned files recursively
svn add --force trunk/ assets/ --no-ignore 2>/dev/null || true
ok "New files staged"

# Remove files that have been deleted from disk
# Use || true so grep exit-1 (no matches) doesn't kill the script
while IFS= read -r f; do
  [[ -n "$f" ]] && svn delete "$f"
done < <(svn status | grep '^!' | awk '{print $2}' || true)
ok "Deleted files removed"

# ── 4. Create version tag (after staging so the tag reflects the full state) ──
echo ""
bold "Tagging release"

info "svn cp trunk/ tags/$VERSION/"
(cd "$SVN_DIR" && svn cp trunk "tags/$VERSION")
ok "Tag created: tags/$VERSION"

# ── 5. Commit ─────────────────────────────────────────────────────────────────
echo ""
bold "Committing to WordPress.org SVN"
info "This may take a moment..."

svn commit ${SVN_USER_FLAG[@]+"${SVN_USER_FLAG[@]}"} -m "Release version $VERSION"

echo ""
bold "Done"
echo ""
echo "  Version $VERSION is live at:"
echo "  https://wordpress.org/plugins/$PLUGIN_SLUG/"
echo ""
