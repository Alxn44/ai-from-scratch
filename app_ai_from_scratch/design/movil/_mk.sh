#!/bin/sh
# Ensambla <nombre>.dc.html = cabecera + _base.css + cuerpo-<nombre>.html + cierre.
set -e
for n in "$@"; do
  cat _head.part _base.css _mid.part "cuerpo-$n.html" _tail.part > "$n.dc.html"
  echo "  $n.dc.html  $(wc -l < "$n.dc.html") lineas"
done
