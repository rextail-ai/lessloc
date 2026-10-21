#!/bin/sh
# What Augment runs on each hook event: Augment runs only script files as hook commands, without arguments. Where node is
# missing, it does nothing.
command -v node >/dev/null 2>&1 || exit 0
exec node "${0%/*}/../hook.mjs" --host augment "$@"
