#!/bin/sh
# What Cursor runs on each hook event of lessloc's Cursor plugin. Where node is missing, it does nothing.
command -v node >/dev/null 2>&1 || exit 0
exec node "${0%/*}/../hook.mjs" --host cursor "$@"
