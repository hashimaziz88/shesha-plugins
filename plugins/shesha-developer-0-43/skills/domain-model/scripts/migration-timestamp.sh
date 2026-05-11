#!/usr/bin/env bash
# Outputs the current UTC timestamp formatted for Shesha FluentMigrator migration IDs.
# Usage: bash scripts/migration-timestamp.sh
#        bash scripts/migration-timestamp.sh 1   # offset +1 second (for multiple migrations)

offset=${1:-0}
date -u -d "+${offset} seconds" +"%Y%m%d%H%M%S" 2>/dev/null \
  || date -u -v+"${offset}"S +"%Y%m%d%H%M%S"
