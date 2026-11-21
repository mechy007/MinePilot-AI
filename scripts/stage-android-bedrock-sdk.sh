#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
destination="$root/android/app/build/node-smoke/sdk"
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT

npm --prefix "$root" run build
npm install --prefix "$temp" --no-save --ignore-scripts --omit=optional bedrock-protocol@3.61.0 minecraft-data@3.119.0
node "$root/scripts/stage-android-bedrock-sdk.mjs" "$temp" 1.26.60
data_notice="$temp/node_modules/minecraft-data/minecraft-data/README.md"
curl --fail --location --silent --show-error --retry 2 --max-time 45 \
    'https://raw.githubusercontent.com/PrismarineJS/minecraft-data/bd8b5c6048e5af9694374b83f25f5b4aade619cc/README.md' \
    -o "$data_notice"
echo "70458c05b33622a05e4e2bbc5811f6221e4085003db25292ef122e0c830397a1  $data_notice" | sha256sum --check -
cp "$root/scripts/android-node-bedrock-smoke.cjs" "$temp/node-smoke.cjs"
cp "$root/scripts/android-xbox-auth-probe.cjs" "$temp/xbox-auth-probe.cjs"
cp "$root/scripts/android-friend-world-session.cjs" "$temp/friend-world-session.cjs"
cp "$root/dist/src/connection/prismarine-world-client.js" "$temp/prismarine-world-client.mjs"
cp "$root/scripts/android-friend-world-session.test.cjs" "$temp/friend-world-session.test.cjs"

python3 - "$temp" <<'PY'
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import sys

runtime = Path(sys.argv[1])
zip_path = runtime / "bedrock-sdk.zip"
with ZipFile(zip_path, "w", ZIP_DEFLATED) as archive:
    for entrypoint in ("node-smoke.cjs", "xbox-auth-probe.cjs", "friend-world-session.cjs", "prismarine-world-client.mjs"):
        archive.write(runtime / entrypoint, entrypoint)
    for source in sorted((runtime / "node_modules").rglob("*")):
        if source.is_file() and not source.is_symlink():
            if source.suffix == ".node":
                raise ValueError(f"Unexpected native Node addon: {source.relative_to(runtime)}")
            archive.write(source, source.relative_to(runtime))

with ZipFile(zip_path) as archive:
    archive.extractall(runtime / "verify")
PY
mv "$temp/node_modules" "$temp/installed-modules"

node "$temp/verify/node-smoke.cjs"
cp "$temp/friend-world-session.test.cjs" "$temp/verify/"
node --test "$temp/verify/friend-world-session.test.cjs"
mkdir -p "$destination"
cp "$temp/bedrock-sdk.zip" "$destination/bedrock-sdk.zip"
du -h "$destination/bedrock-sdk.zip"
