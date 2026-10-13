#!/usr/bin/env bash
#
# Collects raw dependency data for every package in the repo:
# disk size, direct/dev dep counts, heaviest sub-dependencies, and a
# security audit. Emits one JSON object per package to stdout (JSON Lines),
# plus a final line `{"_summary": true, ...}` with repo-wide totals.
#
# This script only COLLECTS data — it does not decide priorities or write
# prose. That's the skill's job once it has this JSON.
#
# Usage: collect-deps-data.sh [package-dir ...]
#   No args = scan the default package list (server client reviewer-core e2e mcp).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"

PACKAGES=("$@")
if [ ${#PACKAGES[@]} -eq 0 ]; then
  PACKAGES=(server client reviewer-core e2e mcp)
fi

TOP_N=10

human_to_kb() {
  # du -sh output like "123M" / "4.2G" / "812K" -> integer KB (for sorting only)
  local val="$1"
  local num unit
  num=$(echo "$val" | sed -E 's/[A-Za-z]+$//')
  unit=$(echo "$val" | sed -E 's/^[0-9.]+//')
  case "$unit" in
    G) awk -v n="$num" 'BEGIN{printf "%d", n*1024*1024}' ;;
    M) awk -v n="$num" 'BEGIN{printf "%d", n*1024}' ;;
    K) awk -v n="$num" 'BEGIN{printf "%d", n}' ;;
    B|"") awk -v n="$num" 'BEGIN{printf "%d", n/1024}' ;;
    *) echo 0 ;;
  esac
}

for pkg in "${PACKAGES[@]}"; do
  dir="$ROOT/$pkg"
  if [ ! -f "$dir/package.json" ]; then
    echo "{\"package\":\"$pkg\",\"error\":\"no package.json at $dir\"}"
    continue
  fi

  # --- package manager detection ---
  if [ -f "$dir/pnpm-lock.yaml" ]; then
    pm="pnpm"
  elif [ -f "$dir/package-lock.json" ]; then
    pm="npm"
  else
    pm="unknown"
  fi

  # --- dep counts from package.json ---
  deps_count=$(jq '(.dependencies // {}) | length' "$dir/package.json" 2>/dev/null || echo 0)
  devdeps_count=$(jq '(.devDependencies // {}) | length' "$dir/package.json" 2>/dev/null || echo 0)

  # --- node_modules total size ---
  if [ -d "$dir/node_modules" ]; then
    total_size=$(du -sh "$dir/node_modules" 2>/dev/null | awk '{print $1}')
  else
    total_size="0"
  fi

  # --- heaviest sub-packages ---
  # pnpm keeps real package content flat under node_modules/.pnpm/<name>@<version>_<hash>/
  # with symlinks at the top level (those report 0B under `du`, since du doesn't follow
  # symlinks by default) — so for pnpm projects we rank .pnpm/* entries instead.
  # npm keeps real content directly under node_modules/<name> (and node_modules/@scope/<name>).
  heaviest_json="[]"
  if [ -d "$dir/node_modules" ]; then
    tmp=$(mktemp)
    if [ -d "$dir/node_modules/.pnpm" ]; then
      du -h -d 1 "$dir/node_modules/.pnpm" 2>/dev/null | grep -v '\.pnpm$' >> "$tmp"
    else
      du -h -d 1 "$dir/node_modules" 2>/dev/null | grep -v "node_modules$" | grep -v '/\.' >> "$tmp"
      for scope_dir in "$dir/node_modules"/@*; do
        [ -d "$scope_dir" ] || continue
        du -h -d 1 "$scope_dir" 2>/dev/null | grep -v "$(basename "$scope_dir")\$" >> "$tmp"
      done
    fi
    heaviest_json=$(awk -F'\t' '{split($2,a,"/"); print $1"\t"a[length(a)]}' "$tmp" \
      | sort -rh | head -n "$TOP_N" \
      | jq -R -s -c 'split("\n") | map(select(length > 0) | split("\t") | {name: .[1], size: (.[0] | gsub("^ +"; ""))})')
    rm -f "$tmp"
  fi

  # --- security audit ---
  audit_json="null"
  audit_summary="{}"
  if [ "$pm" = "pnpm" ]; then
    raw=$(cd "$dir" && pnpm audit --json 2>/dev/null)
    if [ -n "$raw" ]; then
      audit_summary=$(echo "$raw" | jq -c '.metadata.vulnerabilities // {}' 2>/dev/null || echo "{}")
      audit_json=$(echo "$raw" | jq -c '[.advisories // {} | to_entries[] | .value | {module: .module_name, severity: .severity, title: .title, range: .vulnerable_versions, patched: .patched_versions, url: .url}]' 2>/dev/null || echo "null")
    fi
  elif [ "$pm" = "npm" ]; then
    raw=$(cd "$dir" && npm audit --json 2>/dev/null)
    if [ -n "$raw" ]; then
      audit_summary=$(echo "$raw" | jq -c '.metadata.vulnerabilities // {}' 2>/dev/null || echo "{}")
      audit_json=$(echo "$raw" | jq -c '[(.vulnerabilities // {}) | to_entries[] | .value | {module: .name, severity: .severity, via: ([.via[] | if type == "string" then . else .title end]), range: .range, fixAvailable: .fixAvailable}]' 2>/dev/null || echo "null")
    fi
  fi

  jq -n \
    --arg package "$pkg" \
    --arg pm "$pm" \
    --arg total_size "$total_size" \
    --argjson deps_count "$deps_count" \
    --argjson devdeps_count "$devdeps_count" \
    --argjson heaviest "$heaviest_json" \
    --argjson audit_summary "$audit_summary" \
    --argjson advisories "$audit_json" \
    '{package: $package, package_manager: $pm, node_modules_size: $total_size, direct_deps: $deps_count, dev_deps: $devdeps_count, heaviest_subdeps: $heaviest, vulnerability_summary: $audit_summary, advisories: $advisories}'
done
