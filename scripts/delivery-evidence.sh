#!/usr/bin/env bash
# Regenerates the factual evidence behind the Phase 1 delivery agreement.
# Run from the repo root against a full (non-shallow) clone:
#   git fetch --unshallow origin   # once, if the clone is shallow
#   ./scripts/delivery-evidence.sh
set -uo pipefail

CUTOFF="${1:-$(date +%F)}"
TODAY=$(date -d "$CUTOFF" +%s)

echo "# Delivery evidence — generated $CUTOFF"
echo

echo "## Volume"
echo "- period: $(git log --reverse --format='%ad' --date=short | head -1) -> $(git log --format='%ad' --date=short | head -1)"
echo "- commits: $(git rev-list --count HEAD)"
echo "- merged pull requests: $(git log --merges --format='%s' | grep -c 'Merge pull request')"
echo "- work branches pushed: $(git branch -r | wc -l | tr -d ' ')"
echo "- branches never merged: $(git branch -r --no-merged origin/main | wc -l | tr -d ' ')"
echo "- fix-only commits: $(git log --format='%s' | grep -ciE '^fix|fix |תיקון|תקן|bug')"
echo

echo "## Merged pull requests per month"
git log --merges --format='%ad|%s' --date=format:'%Y-%m' | grep 'Merge pull request' | cut -d'|' -f1 | sort | uniq -c | awk '{print "- "$2": "$1}'
echo

echo "## Rounds of work per functional area (matched on branch name)"
git log --merges --format='%s' > /tmp/_merges.$$
: > /tmp/_areas.$$
for k in lead rep task order product deliver payment call quote dashboard pdf search notification price whatsapp permission; do
  c=$(grep -ci "$k" /tmp/_merges.$$ || true)
  if [ "$c" -gt 0 ]; then printf -- "%s|%s\n" "$c" "$k" >> /tmp/_areas.$$; fi
done
sort -t'|' -k1 -rn /tmp/_areas.$$ | awk -F'|' '{print "- "$2": "$1}'
rm -f /tmp/_merges.$$ /tmp/_areas.$$
echo

echo "## Module inventory (size, rounds of change, days since last change)"
echo "| module | lines | commits | last change | days stable |"
echo "|---|---:|---:|---|---:|"
: > /tmp/_mods.$$
for f in src/pages/*.jsx; do
  n=$(basename "$f" .jsx)
  l=$(wc -l < "$f" | tr -d ' ')
  c=$(git log --oneline --follow -- "$f" | wc -l | tr -d ' ')
  last=$(git log --follow --format='%ad' --date=short -- "$f" | head -1)
  if [ -z "$last" ]; then continue; fi
  days=$(( (TODAY - $(date -d "$last" +%s)) / 86400 ))
  printf '| %s | %s | %s | %s | %s |\n' "$n" "$l" "$c" "$last" "$days" >> /tmp/_mods.$$
done
sort -t'|' -k4 -rn /tmp/_mods.$$
rm -f /tmp/_mods.$$
echo

echo "## Work started and never merged"
echo "| last activity | branch |"
echo "|---|---|"
: > /tmp/_br.$$
for b in $(git branch -r --no-merged origin/main | sed 's/^ *//'); do
  printf '| %s | %s |\n' "$(git log -1 --format='%ad' --date=short "$b")" "${b#origin/}" >> /tmp/_br.$$
done
sort -r /tmp/_br.$$
rm -f /tmp/_br.$$
