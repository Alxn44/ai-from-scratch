#!/bin/sh
set -e
for n in "$@"; do
  cat _head.part _base.css _land.css _mid.part "cuerpo-$n.html" _tail.part > "$n.dc.html"
  echo "  $n.dc.html  $(wc -l < "$n.dc.html") lineas"
done
