#!/usr/bin/env bash
# Prüft die Beispiel-PDFs aus out/ auf PDF/A-3b (veraPDF) und Factur-X/EN 16931 (Mustang).
# Lokal: Docker für veraPDF, Java 17+ für Mustang. In CI identisch.
set -euo pipefail
cd "$(dirname "$0")/.."
MUSTANG_VERSION="${MUSTANG_VERSION:-2.26.0}"
mkdir -p tools
[ -f tools/Mustang-CLI.jar ] || curl -sSL -o tools/Mustang-CLI.jar \
  "https://github.com/ZUGFeRD/mustangproject/releases/download/core-${MUSTANG_VERSION}/Mustang-CLI-${MUSTANG_VERSION}.jar"

fail=0
for pdf in out/*.pdf; do
  echo "== veraPDF $pdf"
  docker run --rm -v "$PWD/out:/data" verapdf/cli:latest -f 3b --format text "/data/$(basename "$pdf")" | tee /dev/stderr | grep -q '^PASS' || fail=1
  echo "== Mustang $pdf"
  report=$(java -jar tools/Mustang-CLI.jar --action validate --source "$pdf" 2>/dev/null)
  echo "$report" | grep -E '<summary status=' | tail -1
  if echo "$report" | grep -q 'status="invalid"' || ! echo "$report" | grep -q '<summary status="valid"/>'; then fail=1; fi
done
exit $fail
