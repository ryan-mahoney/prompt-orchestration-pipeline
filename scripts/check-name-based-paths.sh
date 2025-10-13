#!/bin/bash

# Regression guard to prevent re-introduction of name-based path logic
# This script fails if it finds any of the forbidden patterns in the codebase

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Patterns that should not exist in the codebase
PATTERNS=(
  "current/{name}"
  "current/<name>"
  "jobName.*-seed\.json"
)

# Directories to search (exclude node_modules, .git, dist, etc.)
# Allow override via SEARCH_DIRS environment variable
SEARCH_DIRS=(${SEARCH_DIRS:-"src" "scripts" "tests" "docs"})

echo -e "${YELLOW}Checking for forbidden name-based path patterns...${NC}"

found_patterns=false

for pattern in "${PATTERNS[@]}"; do
  echo -e "${YELLOW}Checking pattern: ${pattern}${NC}"
  
  # Search for the pattern in all specified directories
  matches=$(grep -r --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" --include="*.md" --include="*.json" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist "$pattern" "${SEARCH_DIRS[@]}" 2>/dev/null || true)
  
  if [ -n "$matches" ]; then
    echo -e "${RED}❌ FORBIDDEN PATTERN FOUND: ${pattern}${NC}"
    echo -e "${RED}Matches:${NC}"
    echo "$matches"
    found_patterns=true
  else
    echo -e "${GREEN}✅ No matches found for: ${pattern}${NC}"
  fi
  echo
done

if [ "$found_patterns" = true ]; then
  echo -e "${RED}❌ REGRESSION DETECTED: Found forbidden name-based path patterns.${NC}"
  echo -e "${RED}Please remove these patterns and use ID-only paths instead.${NC}"
  echo -e "${RED}Refer to docs/storage.md for the correct ID-only patterns.${NC}"
  exit 1
else
  echo -e "${GREEN}✅ No forbidden patterns found. ID-only storage invariant is preserved.${NC}"
  exit 0
fi
