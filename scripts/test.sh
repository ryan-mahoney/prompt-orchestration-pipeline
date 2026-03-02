#!/usr/bin/env bash
# Test runner that isolates files using mock.module into separate bun processes.
# Bun's mock.module is process-global and persists across test files, causing
# cross-file pollution when tests run concurrently in the same process.

set -euo pipefail

# Find all test files using find (portable, no rg dependency)
ALL_TEST_FILES=$(find src tests -type f \( \
  -name '*.test.ts' -o -name '*.test.tsx' -o \
  -name '*.test.js' -o -name '*.test.jsx' -o \
  -name '*.spec.ts' -o -name '*.spec.tsx' -o \
  -name '*.spec.js' -o -name '*.spec.jsx' \
\) 2>/dev/null | sort)

# Separate files that use mock.module (need process isolation)
ISOLATED_FILES=""
SHARED_FILES=""

for f in $ALL_TEST_FILES; do
  if grep -q 'mock\.module(' "$f" 2>/dev/null; then
    ISOLATED_FILES="$ISOLATED_FILES $f"
  else
    SHARED_FILES="$SHARED_FILES $f"
  fi
done

ISOLATED_COUNT=$(echo $ISOLATED_FILES | wc -w | tr -d ' ')
SHARED_COUNT=$(echo $SHARED_FILES | wc -w | tr -d ' ')

echo "Running $SHARED_COUNT test files (shared process)..."
if [ -n "$SHARED_FILES" ]; then
  bun test $SHARED_FILES
fi

echo ""
echo "Running $ISOLATED_COUNT test files (isolated, using mock.module)..."
FAIL=0
for f in $ISOLATED_FILES; do
  if ! bun test "$f"; then
    FAIL=1
  fi
done

if [ $FAIL -ne 0 ]; then
  exit 1
fi

echo ""
echo "All tests passed."
