#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# svn.sh: Commit a built WordSocket release to WordPress.org SVN
#
# Prerequisites:
#   - Run `npm run dist` first (produces dist/wordsocket.zip and dist/svn-assets/)
#   - SVN checkout at $SVN_DIR (default: ../wordsocket-svn, relative to plugin root)
#
# Usage:
#   npm run svn                       Full release (trunk + assets + tag)
#   npm run svn -- --assets-only      Assets only (icons, banners, screenshots)
#   npm run svn -- --readme-only      readme.txt only (no version bump needed)
#   SVN_USERNAME=yourname npm run svn
#   SVN_DIR=/path/to/wordsocket-svn npm run svn
#
# What it does (full release):
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

# ── Flags ────────────────────────────────────────────────────────────────────
ASSETS_ONLY=false
README_ONLY=false
for arg in "$@"; do
  [[ "$arg" == "--assets-only" ]] && ASSETS_ONLY=true
  [[ "$arg" == "--readme-only" ]] && README_ONLY=true
done

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

bold "WordSocket SVN: v${VERSION}${ASSETS_ONLY:+ (assets only)}${README_ONLY:+ (readme only)}"
echo ""

# ── Preflight ─────────────────────────────────────────────────────────────────
info "Checking prerequisites"

[[ -d "$SVN_DIR" ]]  || die "SVN directory not found: $SVN_DIR"
command -v svn &>/dev/null || die "svn is not installed. Run: brew install subversion"

if [[ "$ASSETS_ONLY" == false && "$README_ONLY" == false ]]; then
  [[ -f "$ZIP" ]] || die "dist/wordsocket.zip not found. Run 'npm run dist' first."
fi

info "Updating SVN checkout"
(cd "$SVN_DIR" && svn update)

if [[ "$ASSETS_ONLY" == false && "$README_ONLY" == false ]]; then
  # Check remote for existing tag (local checkout may be stale)
  if svn list "https://plugins.svn.wordpress.org/wordsocket/tags/$VERSION" &>/dev/null; then
    die "Tag $VERSION already exists in SVN. Bump the version before releasing."
  fi
fi

ok "Prerequisites met"

if [[ "$README_ONLY" == true ]]; then
  # ── readme-only: copy readme.txt to trunk and commit ───────────────────────
  echo ""
  bold "Updating readme.txt"
  [[ -f "$PLUGIN_DIR/readme.txt" ]] || die "readme.txt not found in plugin directory."
  cp "$PLUGIN_DIR/readme.txt" "$SVN_DIR/trunk/readme.txt"
  ok "readme.txt copied to trunk/"

  echo ""
  bold "Committing to WordPress.org SVN"
  info "This may take a moment..."
  cd "$SVN_DIR"
  svn commit ${SVN_USER_FLAG[@]+"${SVN_USER_FLAG[@]}"} -m "Update readme.txt"

  echo ""
  bold "Done"
  echo ""
  exit 0
fi

if [[ "$ASSETS_ONLY" == false ]]; then
  # ── 1. Sync trunk ───────────────────────────────────────────────────────────
  echo ""
  bold "Syncing trunk"

  info "Clearing trunk/ contents"
  find "$SVN_DIR/trunk" -mindepth 1 -delete
  mkdir -p "$SVN_DIR/trunk"

  info "Unzipping dist/${PLUGIN_SLUG}.zip into trunk/"
  unzip -q "$ZIP" -d /tmp/wps-svn-stage
  cp -r /tmp/wps-svn-stage/"$PLUGIN_SLUG"/. "$SVN_DIR/trunk/"
  rm -rf /tmp/wps-svn-stage
  rm -rf "$SVN_DIR/trunk/vendor"
  ok "trunk/ updated"
fi

# ── 2. Sync SVN assets ────────────────────────────────────────────────────────
echo ""
bold "Syncing assets"

if [[ -d "$SVN_ASSETS_SRC" ]]; then
  mkdir -p "$SVN_DIR/assets"
  find "$SVN_DIR/assets" -maxdepth 1 -type f -delete
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

if [[ "$ASSETS_ONLY" == false ]]; then
  svn add --force trunk/ assets/ --no-ignore 2>/dev/null || true
else
  svn add --force assets/ --no-ignore 2>/dev/null || true
fi
ok "New files staged"

while IFS= read -r f; do
  [[ -n "$f" ]] && svn delete "$f"
done < <(svn status | grep '^!' | awk '{print $2}' || true)
ok "Deleted files removed"

if [[ "$ASSETS_ONLY" == false ]]; then
  # ── 4. Create version tag ───────────────────────────────────────────────────
  echo ""
  bold "Tagging release"

  info "svn cp trunk/ tags/$VERSION/"
  (cd "$SVN_DIR" && svn cp trunk "tags/$VERSION")
  ok "Tag created: tags/$VERSION"
fi

# ── 5. Commit ─────────────────────────────────────────────────────────────────
echo ""
bold "Committing to WordPress.org SVN"
info "This may take a moment..."

if [[ "$ASSETS_ONLY" == true ]]; then
  svn commit ${SVN_USER_FLAG[@]+"${SVN_USER_FLAG[@]}"} -m "Update assets"
else
  svn commit ${SVN_USER_FLAG[@]+"${SVN_USER_FLAG[@]}"} -m "Release version $VERSION"
fi

echo ""
bold "Done"
echo ""
if [[ "$ASSETS_ONLY" == false ]]; then
  echo "  Version $VERSION is live at:"
  echo "  https://wordpress.org/plugins/$PLUGIN_SLUG/"
fi
echo ""
