#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# dist.sh: Build a WordPress.org-ready release of the WPSignal plugin
#
# Outputs:
#   dist/signal-{version}.zip   Plugin zip for WordPress.org upload / SVN trunk
#   dist/svn-assets/            Icons, banners, screenshots for SVN assets/
#
# SVN asset naming (WordPress.org convention):
#   icon-128x128.png            from wpsignal-128x128.png  (or icon-128x128.png)
#   icon-256x256.png            from wpsignal-256x256.png  (or icon-256x256.png)
#   banner-772x250.jpg          from wpsignal-772x250.jpg  (or banner-772x250.jpg)
#   banner-1544x500.jpg         from wpsignal-1544x500.jpg (or banner-1544x500.jpg)
#   screenshot-1.png            unchanged
#   screenshot-2.png            unchanged
#
# Plugin assets are resolved in order:
#   1. $WPS_ASSETS_DIR env var
#   2. ./wp-org-assets/ (relative to the plugin root)
#   3. Skipped with a warning if neither is found
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

# ── Version ───────────────────────────────────────────────────────────────────
VERSION="$(node -p "require('./package.json').version")"
PLUGIN_SLUG="signal"
ZIP_NAME="${PLUGIN_SLUG}-${VERSION}.zip"
DIST_DIR="$PLUGIN_DIR/dist"
STAGE_DIR="$DIST_DIR/$PLUGIN_SLUG"

bold "WPSignal dist: v${VERSION}"
echo ""

# ── 1. Clean ──────────────────────────────────────────────────────────────────
info "Cleaning dist/"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# ── 2. Build JS/CSS assets ────────────────────────────────────────────────────
info "Building JS/CSS assets (npm run build)"
npm run build --silent
ok "Assets built"

# ── 3. Generate POT ───────────────────────────────────────────────────────────
info "Generating POT (npm run make-pot)"
npm run make-pot --silent 2>&1 | grep -v "^$" || true
ok "POT generated"

# ── 4. Stage plugin files (respecting .distignore) ───────────────────────────
info "Staging plugin files → dist/${PLUGIN_SLUG}/"
mkdir -p "$STAGE_DIR"

# Build rsync exclude list from .distignore (skip blank lines and comments)
RSYNC_EXCLUDES=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  RSYNC_EXCLUDES+=(--exclude="$line")
done < "$PLUGIN_DIR/.distignore"

# Always exclude the dist directory itself and build-time files
RSYNC_EXCLUDES+=(
  --exclude="/dist/"
  --exclude="/bin/"
  --exclude="/wp-org-assets/"
  --exclude="/.DS_Store"
  --exclude="**/.DS_Store"
)

rsync -a --no-owner --no-group \
  "${RSYNC_EXCLUDES[@]}" \
  "$PLUGIN_DIR/" "$STAGE_DIR/"

ok "Files staged"

# ── 5. Create zip ─────────────────────────────────────────────────────────────
info "Creating ${ZIP_NAME}"
(cd "$DIST_DIR" && zip -rq "$ZIP_NAME" "$PLUGIN_SLUG/")
rm -rf "$STAGE_DIR"
ok "Zip created: dist/${ZIP_NAME}"

# ── 6. SVN assets (icons, banners, screenshots) ───────────────────────────────
echo ""
bold "SVN assets"

# Resolve asset source directory
ASSETS_SRC="${WPS_ASSETS_DIR:-}"
if [[ -z "$ASSETS_SRC" ]]; then
  LOCAL_ASSETS="$PLUGIN_DIR/wp-org-assets"
  if [[ -d "$LOCAL_ASSETS" ]]; then
    ASSETS_SRC="$LOCAL_ASSETS"
  fi
fi

if [[ -z "$ASSETS_SRC" || ! -d "$ASSETS_SRC" ]]; then
  warn "No asset directory found. Set WPS_ASSETS_DIR or create ./wp-org-assets/"
  warn "Skipping SVN assets: add icons, banners, and screenshots manually."
else
  SVN_ASSETS_DIR="$DIST_DIR/svn-assets"
  mkdir -p "$SVN_ASSETS_DIR"

  # Map: source filename → WordPress.org canonical name (bash 3.2 compatible)
  # Format: "src_filename:dest_filename"
  ASSET_PAIRS=(
    "wpsignal-128x128.png:icon-128x128.png"
    "icon-128x128.png:icon-128x128.png"
    "wpsignal-256x256.png:icon-256x256.png"
    "icon-256x256.png:icon-256x256.png"
    "wpsignal-772x250.jpg:banner-772x250.jpg"
    "banner-772x250.jpg:banner-772x250.jpg"
    "wpsignal-1544x500.jpg:banner-1544x500.jpg"
    "banner-1544x500.jpg:banner-1544x500.jpg"
    "screenshot-1.png:screenshot-1.png"
    "screenshot-2.png:screenshot-2.png"
    "screenshot-3.png:screenshot-3.png"
    "screenshot-4.png:screenshot-4.png"
  )

  COPIED=0
  for pair in "${ASSET_PAIRS[@]}"; do
    src_name="${pair%%:*}"
    dest_name="${pair##*:}"
    src_file="$ASSETS_SRC/$src_name"
    if [[ -f "$src_file" ]]; then
      cp "$src_file" "$SVN_ASSETS_DIR/$dest_name"
      info "  $src_name → svn-assets/$dest_name"
      COPIED=$(( COPIED + 1 ))
    fi
  done

  if [[ $COPIED -eq 0 ]]; then
    warn "No matching asset files found in: $ASSETS_SRC"
  else
    ok "$COPIED asset(s) copied to dist/svn-assets/"
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
bold "Done"
echo ""
echo "  Plugin zip:   dist/${ZIP_NAME}"
if [[ -d "${DIST_DIR}/svn-assets" ]]; then
  echo "  SVN assets:   dist/svn-assets/"
fi
echo ""
echo "  Upload ${ZIP_NAME} at: https://wordpress.org/plugins/developers/add/"
echo "  Commit svn-assets/ to the SVN assets/ directory."
echo ""
