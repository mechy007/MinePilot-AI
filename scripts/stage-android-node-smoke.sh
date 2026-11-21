#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
destination="$root/android/app/build/node-smoke"
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT

download() {
    local url=$1 sha=$2 output=$3
    curl --fail --location --silent --show-error --retry 2 --max-time 180 "$url" -o "$output"
    echo "$sha  $output" | sha256sum --check -
}

download 'https://github.com/fogtape/nodejs-mobile/releases/download/v24.22.1-0/nodejs-mobile-android-24.22.1-0.zip' \
    d6fd9f610fe5d81fede8f0d400c5a62723247725a19831835f15abf4f0604250 "$temp/android.zip"
unzip -q "$temp/android.zip" 'bin/arm64-v8a/libnode.so' 'include/node/*' -d "$temp/runtime"
mkdir -p "$temp/runtime/notices" "$destination"
download 'https://raw.githubusercontent.com/nodejs/node/ce7aaf1cee78b8cf0ce17364260535c418d3ed26/LICENSE' \
    5888dbb9a1d2b18f2c3e6c5f6af1b39de658372b402a0577b002777f14c62ace "$temp/runtime/notices/Node.js-LICENSE.txt"
download 'https://raw.githubusercontent.com/fogtape/nodejs-mobile/b5bcc8d8e70f055333cd5efc317e3eb55bf0c9a5/LICENSE' \
    c373dabed995013e091b1908996a69a1647ef19d400e6c1fd4b7fb06d8bc0f66 "$temp/runtime/notices/Node.js-Mobile-LICENSE.txt"
cp -R "$temp/runtime/." "$destination/"
