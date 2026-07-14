#!/usr/bin/env bash
# Release check for the VSCode extension. Runs every check and summarizes.

NAMES=(); STATUSES=(); DETAILS=()

announce() { printf "→ %s...\n" "$1"; }

record() { NAMES+=("$1"); STATUSES+=("$2"); DETAILS+=("$3"); }

PKG_VERSION=$(python3 -c "import json;print(json.load(open('package.json'))['version'])")
echo "== flutter-xwidget (VSCode) $PKG_VERSION release check =="

announce "git status"
DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [ "$DIRTY" = "0" ]; then record "git tree clean" pass "no changes"
else record "git tree clean" fail "$DIRTY dirty/untracked files"; fi

announce "typecheck"
if OUT=$(npm run typecheck 2>&1); then record "typecheck" pass "no issues"
else record "typecheck" fail "$(echo "$OUT" | grep -m1 'error TS' | head -c 60)"; fi

announce "tests"
# NO_COLOR + escape-stripping: vitest colorizes even piped output when the
# caller's environment forces color (e.g. FORCE_COLOR), and ANSI codes inside
# "Tests  19 passed" break the parse below.
OUT=$(NO_COLOR=1 npm test 2>&1 | sed "s/$(printf '\033')\[[0-9;]*m//g")
if echo "$OUT" | grep -qE "Tests +[0-9]+ passed" && ! echo "$OUT" | grep -q "failed"; then
  N=$(echo "$OUT" | grep -oE 'Tests +[0-9]+ passed' | grep -oE '[0-9]+')
  record "tests" pass "$N passed"
else
  DETAIL=$(echo "$OUT" | grep -m1 -iE 'fail|error' | head -c 60)
  [ -z "$DETAIL" ] && DETAIL=$(echo "$OUT" | grep -m1 . | head -c 60)
  record "tests" fail "${DETAIL:-tests produced no output}"
fi

announce "build"
if OUT=$(npm run build 2>&1); then record "build" pass "production bundle builds"
else record "build" fail "$(echo "$OUT" | grep -m1 -i error | head -c 60)"; fi

announce "changelog"
CL_HEAD=$(grep -m1 '^## ' CHANGELOG.md | sed -E 's/^## \[([^]]+)\].*/\1/')
if [ "$CL_HEAD" = "$PKG_VERSION" ]; then
  ENTRIES=$(awk '/^## /{n++} n==1 && /^- /{c++} END{print c+0}' CHANGELOG.md)
  if [ "$ENTRIES" -gt 0 ]; then record "changelog" pass "$PKG_VERSION heading with $ENTRIES entries"
  else record "changelog" fail "$PKG_VERSION heading has no entries"; fi
else
  record "changelog" fail "heading '$CL_HEAD' != version '$PKG_VERSION'"
fi

announce "dependencies"
OUTDATED=$(npm outdated --json 2>/dev/null | python3 -c "import json,sys
try: print(len(json.load(sys.stdin)))
except Exception: print(0)")
record "dependencies" pass "$OUTDATED upgradable"

echo ""
FAILED=0; i=0
while [ $i -lt ${#NAMES[@]} ]; do
  if [ "${STATUSES[$i]}" = "pass" ]; then MARK="✓"; else MARK="✗"; FAILED=$((FAILED+1)); fi
  printf " %s %-16s %s\n" "$MARK" "${NAMES[$i]}" "${DETAILS[$i]}"
  i=$((i+1))
done
TOTAL=${#NAMES[@]}
echo "--------------------------------------"
if [ $FAILED -eq 0 ]; then echo "$TOTAL/$TOTAL passed — READY"; exit 0
else echo "$((TOTAL-FAILED))/$TOTAL passed — NOT READY"; exit 1; fi
