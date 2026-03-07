#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CMD=$1
if [ "$CMD" = "build" ]; then
  node "$SCRIPT_DIR/tools/build.js"
else
  node "$SCRIPT_DIR/tools/db-manage.js" "$@"
fi
