#!/usr/bin/env bash
#
# release.sh: Bump version, update changelogs, commit, tag, and push.
#
# Usage:
#   ./bin/release.sh [--tested <wp-version>] <version> ["changelog entry"] ...
#
# Example:
#   ./bin/release.sh 0.8.0 \
#     "Fixed: connect flow redirect after login when not authenticated" \
#     "Fixed: RTC opt-in detection for WordPress 7.0 Beta 6"
#
# What it updates:
#   package.json     version field
#   wordsocket.php   Version header + VERSION constant (+ Tested up to, with --tested)
#   readme.txt       Stable tag, Changelog section, Upgrade Notice section (+ Tested up to)
#   readme.md        WP CLI install URL tag
#   CHANGELOG.md     Changelog entry
#   ../config/versions.json and ../site/src/lib/versions.json via ../scripts/versions.sh
#                    (the site copy lives in the site repo: commit it there)
#
# Then commits, tags vX.Y.Z, and pushes. The tag triggers the release
# workflow (.github/workflows/release.yml), which typechecks, builds the zip,
# verifies its version, creates the GitHub release, and only then publishes
# the same zip to WordPress.org SVN. Nothing else to run; watch the Actions
# tab. If the workflow fails, fix the cause, then move the tag onto the fix:
#   git tag -fs vX.Y.Z -m "Release vX.Y.Z" && git push --force origin vX.Y.Z
# 
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PLUGIN_DIR"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  \033[34m→\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
die()  { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# Args
TESTED_UP_TO=""
if [[ "${1:-}" == "--tested" ]]; then
  TESTED_UP_TO="${2:-}"; shift 2 || true
  [[ "$TESTED_UP_TO" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] \
    || die "--tested needs a WordPress version like 7.1 (got: '$TESTED_UP_TO')"
fi

if [[ $# -lt 1 ]]; then
  bold "Usage: $0 [--tested <wp-version>] <version> [\"changelog entry\"] ..."
  echo ""
  echo "  $0 --tested 7.1 0.8.0 \"Fixed connect flow redirect\" \"Fixed RTC opt-in for WP 7 Beta 6\""
  exit 1
fi

NEW_VERSION="$1"; shift

[[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || die "Version must be X.Y.Z (got: $NEW_VERSION)"

CURRENT_VERSION="$(node -p "require('./package.json').version")"

[[ "$NEW_VERSION" != "$CURRENT_VERSION" ]] \
  || die "Already at v$NEW_VERSION: nothing to bump."

# Collect changelog bullets from remaining args
BULLETS=()
while [[ $# -gt 0 ]]; do
  BULLETS+=("$1"); shift
done

bold "Releasing v$CURRENT_VERSION → v$NEW_VERSION"
echo ""

# 1. package.json
info "package.json"
node -e "
  const fs = require('fs');
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  p.version = '$NEW_VERSION';
  fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
"
ok "package.json → $NEW_VERSION"

# 2. wordsocket.php
info "wordsocket.php"
perl -i -pe "s/(Version:\s+)\Q$CURRENT_VERSION\E/\${1}$NEW_VERSION/" wordsocket.php
perl -i -pe "s/const VERSION = '\Q$CURRENT_VERSION\E'/const VERSION = '$NEW_VERSION'/" wordsocket.php
ok "wordsocket.php → $NEW_VERSION"

if [[ -n "$TESTED_UP_TO" ]]; then
  perl -i -pe "s/(Tested up to:\s+)[0-9.]+/\${1}$TESTED_UP_TO/" wordsocket.php
  perl -i -pe "s/^(Tested up to: )[0-9.]+/\${1}$TESTED_UP_TO/" readme.txt
  ok "Tested up to → $TESTED_UP_TO (wordsocket.php + readme.txt)"
fi

# 2b. Shared version registry
VERSIONS_SH="$PLUGIN_DIR/../scripts/versions.sh"
if [[ -x "$VERSIONS_SH" ]]; then
  info "config/versions.json"
  "$VERSIONS_SH" set wordsocket "$NEW_VERSION" >/dev/null
  ok "versions.json → $NEW_VERSION (site copy is in the site repo: commit it there)"
fi

# 3. readme.txt + readme.md + CHANGELOG.md
info "readme.txt + readme.md + CHANGELOG.md"

# Pass data to Python via env vars to avoid quoting/escaping issues
export _WPS_NEW="$NEW_VERSION"
export _WPS_OLD="$CURRENT_VERSION"
export _WPS_BULLETS
_WPS_BULLETS="$(printf '%s\n' ${BULLETS[@]+"${BULLETS[@]}"})"

python3 - << 'PYEOF'
import os, re

new_ver = os.environ['_WPS_NEW']
old_ver = os.environ['_WPS_OLD']
raw     = os.environ.get('_WPS_BULLETS', '').strip()
bullets = [b for b in raw.splitlines() if b.strip()]

# readme.txt
with open('readme.txt') as f:
    txt = f.read()

# Stable tag
txt = txt.replace(f'Stable tag: {old_ver}', f'Stable tag: {new_ver}')

# Changelog block
chg = f'= {new_ver} =\n'
chg += (''.join(f'* {b}\n' for b in bullets) if bullets else '') + '\n'

# Replace an existing section for this version when bullets are given (a
# hand-written section is kept when none are), or prepend a new one.
# Matches the header line and all following non-section-header lines.
existing = re.search(
    r'= ' + re.escape(new_ver) + r' =\n(?:(?!= [0-9]).*\n)*',
    txt
)
if existing and not bullets:
    pass
elif existing:
    txt = re.sub(
        r'= ' + re.escape(new_ver) + r' =\n(?:(?!= [0-9]).*\n)*',
        chg,
        txt,
        count=1
    )
else:
    txt = txt.replace('== Changelog ==\n', f'== Changelog ==\n\n{chg}', 1)

# Upgrade Notice: use first bullet or a generic line
notice = bullets[0] if bullets else f'See changelog for details.'
upgrade_block = txt.split('== Upgrade Notice ==', 1)
if len(upgrade_block) > 1 and f'= {new_ver} =' not in upgrade_block[1]:
    txt = txt.replace(
        '== Upgrade Notice ==\n',
        f'== Upgrade Notice ==\n\n= {new_ver} =\n{notice}\n',
        1
    )

with open('readme.txt', 'w') as f:
    f.write(txt)

# readme.md (install URL only)
with open('readme.md') as f:
    md = f.read()

md = re.sub(
    r'releases/download/[^/]+/wordsocket\.zip',
    f'releases/download/v{new_ver}/wordsocket.zip',
    md
)

with open('readme.md', 'w') as f:
    f.write(md)

# CHANGELOG.md
with open('CHANGELOG.md') as f:
    changelog = f.read()

if not re.search(r'^\*\*' + re.escape(new_ver) + r'\*\*', changelog, re.MULTILINE):
    summary = bullets[0] if bullets else f'Release {new_ver}'
    entry = f'**{new_ver}** - {summary}.\n\n'
    changelog = entry + changelog

with open('CHANGELOG.md', 'w') as f:
    f.write(changelog)

PYEOF

unset _WPS_NEW _WPS_OLD _WPS_BULLETS
ok "readme.txt + readme.md + CHANGELOG.md → $NEW_VERSION"

# 4. Git
echo ""
bold "Git"

git add package.json wordsocket.php readme.txt readme.md CHANGELOG.md
git commit -m "chore: release v${NEW_VERSION}"
ok "Committed"

git tag -s -m "Release v${NEW_VERSION}" "v${NEW_VERSION}"
ok "Tagged v${NEW_VERSION}"

git push && git push origin "v${NEW_VERSION}"
ok "Pushed: the release workflow builds the zip, creates the GitHub release, then publishes to WordPress.org"

echo ""
bold "Done: v${NEW_VERSION}"
echo ""
echo "  Watch the workflow: https://github.com/wpsignal/wordsocket/actions"
echo "  GitHub release:     https://github.com/wpsignal/wordsocket/releases/tag/v${NEW_VERSION}"
echo "  WordPress.org:      https://wordpress.org/plugins/wordsocket/ (a few minutes after the workflow finishes)"
echo ""
