#!/bin/bash
# Compila y corre la app en el simulador, de cero si hace falta.
#
# Existe porque el iPhone fisico del proyecto no acepta equipos de firma
# gratuitos (iOS 26.6 nunca ofrece la pantalla de confiar; probado con once
# variantes el 2026-08-29, incluidos certificado nuevo, reinicio y reset de
# privacidad). Hasta que la cuenta sea de pago, el dispositivo de prueba es
# este. El simulador no firma ni pide confianza: no puede reproducir ese
# problema, y tampoco lo padece.
set -euo pipefail
cd "$(dirname "$0")"

NOMBRE="Prueba iPhone"
RUNTIME=$(xcrun simctl list runtimes | grep -oE 'com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9-]+' | tail -1)
TIPO=$(xcrun simctl list devicetypes | grep -oE 'com\.apple\.CoreSimulator\.SimDeviceType\.iPhone-17[^)]*' | head -1)

UD=$(xcrun simctl list devices | grep "$NOMBRE" | grep -oE '[0-9A-F-]{36}' | head -1)
if [ -z "$UD" ]; then
  echo "creando simulador ($TIPO, $RUNTIME)"
  UD=$(xcrun simctl create "$NOMBRE" "$TIPO" "$RUNTIME")
fi

xcrun simctl bootstatus "$UD" -b
open -a Simulator

[ -d IAdesdeCero.xcodeproj ] || xcodegen generate

xcodebuild -project IAdesdeCero.xcodeproj -scheme IAdesdeCero \
  -destination "id=$UD" -derivedDataPath build-sim -configuration Debug \
  -quiet build

xcrun simctl install "$UD" build-sim/Build/Products/Debug-iphonesimulator/IAdesdeCero.app
xcrun simctl terminate "$UD" io.alpadev.iadesdecero 2>/dev/null || true
xcrun simctl launch "$UD" io.alpadev.iadesdecero
echo "corriendo contra https://aifromscratch.shop"
