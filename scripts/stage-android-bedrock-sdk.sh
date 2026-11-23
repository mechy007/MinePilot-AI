#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
destination="$root/android/app/build/node-smoke/sdk"
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT

npm --prefix "$root" run build
npm install --prefix "$temp" --no-save --ignore-scripts --omit=optional bedrock-protocol@3.61.0 minecraft-data@3.119.0 prismarine-auth@3.1.1 nethernet@1.1.2
# Live responses report expires_in in seconds. In 3.1.1 the live cache adds
# that value directly to Date.now(), which expires a one-hour token in 3.6 seconds.
node - "$temp/node_modules/prismarine-auth/src/TokenManagers/LiveTokenManager.js" <<'JS'
const fs = require('node:fs');
const file = process.argv[2];
const source = fs.readFileSync(file, 'utf8');
const old = 'token.obtainedOn + token.expires_in';
if (source.split(old).length !== 3) {
  throw new Error('Review the live token lifetime patch for this SDK version');
}
fs.writeFileSync(file, source.replaceAll(old, 'token.obtainedOn + Number(token.expires_in) * 1000'));
JS
node "$root/scripts/stage-android-bedrock-sdk.mjs" "$temp" 1.26.60
# Surface the pinned SDK's join stages without forwarding private session data.
# Publishing the bot's own Xbox activity is optional for joining a host.
node - "$temp/node_modules" <<'JS'
const fs = require('node:fs');
const path = require('node:path');
function patch(relativePath, replacements) {
  const file = path.join(process.argv[2], relativePath);
  let source = fs.readFileSync(file, 'utf8');
  for (const [from, to] of replacements) {
    if (source.split(from).length !== 2) throw new Error(`Review join patch for ${relativePath}`);
    source = source.replace(from, to);
  }
  fs.writeFileSync(file, source);
}
patch('bedrock-protocol/src/client/auth.js', [
  ['  const session = await xbox.joinSession(world.sessionRef.name, requestOptions)',
    "  client.emit('minepilot_join_step', 'xbox_membership')\n  const session = await xbox.joinSession(world.sessionRef.name, requestOptions)"],
  ['  const networkId = session.current.properties?.custom?.SupportedConnections?.find(e => e.NetherNetId)?.NetherNetId',
    "  client.emit('minepilot_join_step', 'world_transport')\n  const networkId = session.current.properties?.custom?.SupportedConnections?.find(e => e.NetherNetId)?.NetherNetId"],
  ['  await session.setActivity()\n  options.nethernet.networkId = BigInt(networkId)',
    '  options.nethernet.networkId = BigInt(networkId)']
]);
patch('bedrock-protocol/src/client.js', [
  ['this.connection.nethernet.signalHandler = this.nethernet.signalling.write.bind(this.nethernet.signalling)',
    `this.connection.nethernet.signalHandler = signal => {
          this.nethernet.signalling.write(signal)
          if (signal.type === 'CONNECTREQUEST') this.emit('minepilot_join_trace', 'offer_sent')
        }`],
  ['if (!this._closed) return this.connection.nethernet.handleSignal(signal)',
    `if (!this._closed) {
              if (signal.type === 'CONNECTRESPONSE' && this.connection.nethernet.isExpectedSignal(signal)) {
                this.emit('minepilot_join_trace', 'answer_received')
              }
              return this.connection.nethernet.handleSignal(signal)
            }`],
  ['    this.connection.onConnected = () => {',
    `    this.connection.onConnected = () => {
      if (this.options.transport === 'nethernet' && this.options.nethernet.signalling === 'services') {
        this.emit('minepilot_join_trace', 'peer_connected')
      }`],
  ['new NethernetClient({ networkId, host: this.options.host, webrtcBackend: this.options.nethernet.webrtcBackend })',
    'new NethernetClient({ ...this.options.nethernet, networkId, host: this.options.host })'],
  ['        const { NethernetSignal } = require(\'./nethernet/signalling\')',
    "        this.emit('minepilot_join_step', 'nethernet_signalling')\n        const { NethernetSignal } = require('./nethernet/signalling')"],
  ['.then(() => { if (!this._closed) this._connect(sessionData) })',
    ".then(() => {\n            if (this._closed) return\n            this.emit('minepilot_join_step', 'nethernet_peer')\n            this._connect(sessionData)\n          })"],
  ['    this.connection.onCloseConnection = (reason) => {',
    `    this.connection.onCloseConnection = (reason) => {
      if (!this._closed && this.status === ClientStatus.Disconnected &&
          this.options.transport === 'nethernet' && this.options.nethernet.signalling === 'services') {
        const code = typeof reason === 'string' && /^connecterror:(\\d{1,3})$/.exec(reason)
        return this.onConnectionError(Object.assign(new Error('NetherNet peer closed'), {
          nethernetCode: code ? Number(code[1]) : undefined
        }))
      }`]
]);
patch('bedrock-protocol/src/nethernet/index.js', [
  ['{ webrtcBackend: options.webrtcBackend }', `{
        webrtcBackend: options.webrtcBackend,
        responseTimeoutMs: options.responseTimeoutMs,
        inactivityTimeoutMs: options.inactivityTimeoutMs
      }`]
]);
// Werift gathers local candidates into its offer. Sending those candidates
// separately before the offer can reach a host that has no peer to apply them to.
patch('nethernet/src/client.js', [
  ['    rtcConnection.onicecandidate = (event) => {\n      if (event.candidate && isCurrent()) {',
    '    let offerSent = false\n    rtcConnection.onicecandidate = (event) => {\n      if (event.candidate && isCurrent() && (!this._externalSignaling || offerSent)) {'],
  ['new SignalStructure(SignalType.ConnectRequest, this.connectionId, sdp, this.serverNetworkId)\n      )',
    'new SignalStructure(SignalType.ConnectRequest, this.connectionId, sdp, this.serverNetworkId)\n      )\n      offerSent = true']
]);
JS
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
