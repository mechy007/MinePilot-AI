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
// Xbox friend-world JSON-RPC addressing has two IDs: PmsgId routes the outer
// message, and NetherNetId identifies the peer in the inner WebRTC exchange.
patch('bedrock-protocol/src/client/auth.js', [
  ['  // Select the connection that advertises a NetherNet id. The ConnectionType value for NetherNet is not stable across\n  // client versions (a live 1.26.51 host advertises 7, this code assumed 3), so match on the NetherNetId itself.\n',
    ''],
  ["  const networkId = session.current.properties?.custom?.SupportedConnections?.find(e => e.NetherNetId)?.NetherNetId\n\n  if (!networkId) throw Error('Couldn\\'t find a Nethernet ID to connect to.')\n\n  options.nethernet.networkId = BigInt(networkId)",
    `  const connections = session.current.properties?.custom?.SupportedConnections
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
  const networkId = (value, acceptsUuid) => {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) return
    const text = String(value)
    if (/^[1-9][0-9]{0,19}$/.test(text) && BigInt(text) <= 18446744073709551615n) return BigInt(text)
    if (acceptsUuid && uuid.test(text)) return text.toLowerCase()
  }
  let legacy
  for (const connection of Array.isArray(connections) ? connections : []) {
    if (!connection) continue
    const type = String(connection.ConnectionType ?? '')
    if (type === '7') {
      const { PmsgId: playerId } = connection
      const id = networkId(connection.NetherNetId, true)
      if (id && typeof playerId === 'string' && uuid.test(playerId) && playerId !== '00000000-0000-0000-0000-000000000000') {
        options.nethernet.networkId = id
        options.nethernet._signallingProtocol = 'jsonrpc'
        options.nethernet._peerPlayerId = playerId.toLowerCase()
        return
      }
    } else if (type === '3' || type === '') {
      legacy ??= networkId(connection.NetherNetId ?? connection.WebRTCNetworkId, false)
    }
  }
  if (!legacy) throw Error("Couldn't find a Nethernet ID to connect to.")
  options.nethernet.networkId = legacy`]
]);
patch('bedrock-protocol/src/client.js', [
  ['{ protocol: this.options.nethernet._signallingProtocol, host: this.options.nethernet._signallingHost, timeout: this.options.nethernet.signallingConnectTimeout }',
    `{
            protocol: this.options.nethernet._signallingProtocol,
            host: this.options.nethernet._signallingHost,
            timeout: this.options.nethernet.signallingConnectTimeout,
            peerPlayerId: this.options.nethernet._peerPlayerId
          }`]
]);
patch('bedrock-protocol/src/nethernet/signalling.js', [
  ['    this.host = options.host || null', '    this.host = options.host || null\n    this.peerPlayerId = options.peerPlayerId'],
  ['parseJsonRpcReceiveItem(item)', 'parseJsonRpcReceiveItem(item, this.peerPlayerId)'],
  ['encodeSignal(signal, this.networkId, this._protocol, randomUUID(), randomUUID())',
    'encodeSignal(signal, this.networkId, this._protocol, randomUUID(), randomUUID(), this.peerPlayerId)']
]);
patch('bedrock-protocol/src/nethernet/signallingCodec.js', [
  ['function parseJsonRpcReceiveItem (item) {', 'function parseJsonRpcReceiveItem (item, peerPlayerId) {'],
  ['  const networkId = item.From || item.from || item.fromPlayerId || signal.networkId',
    `  const from = item.From || item.from || item.fromPlayerId
  if (peerPlayerId) {
    if (typeof from !== 'string' || from.toLowerCase() !== peerPlayerId) return null
    // Keep the inner ID so the NetherNet client can validate the peer and connection.
    if (signal.networkId) signal.networkId = signal.networkId.toLowerCase()
    return signal
  }
  const networkId = from || signal.networkId`],
  ['function encodeSignal (signal, networkId, protocol, id, messageId) {',
    'function encodeSignal (signal, networkId, protocol, id, messageId, peerPlayerId) {'],
  ['toPlayerId: String(signal.networkId)', 'toPlayerId: peerPlayerId ?? String(signal.networkId)']
]);
// The host issues an account-specific login nonce through the joined Xbox session.
patch('bedrock-protocol/src/client/auth.js', [
  ['async function worldAuthenticate (client, options) {',
    `async function applyWorldNonce (client, options, session, xuid, parentSignal) {
  client.emit('minepilot_join_step', 'world_nonce')
  const deadline = AbortSignal.timeout(12000)
  const signal = AbortSignal.any([parentSignal, deadline])
  let document = session.current
  try {
    for (;;) {
      signal.throwIfAborted()
      const nonce = document?.properties?.custom?.nonces?.[xuid]
      if (typeof nonce === 'string' && /^[0-9a-f]{1,256}$/i.test(nonce)) {
        options.skinData = { ...options.skinData, Nonce: nonce }
        return
      }
      await require('node:timers/promises').setTimeout(1000, undefined, { signal })
      document = await session.get({ signal })
    }
  } catch (error) {
    parentSignal.throwIfAborted()
    if (deadline.aborted) throw new Error('Xbox world login nonce unavailable')
    throw error
  }
}

async function worldAuthenticate (client, options) {`],
  ['        options.nethernet._peerPlayerId = playerId.toLowerCase()\n        return',
    '        options.nethernet._peerPlayerId = playerId.toLowerCase()\n        await applyWorldNonce(client, options, session, profile.xuid, controller.signal)\n        return'],
  ['  options.nethernet.networkId = legacy',
    `  options.nethernet.networkId = legacy
  if (session.current.properties?.custom?.nonces != null) {
    await applyWorldNonce(client, options, session, profile.xuid, controller.signal)
  }`]
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
cp "$root/scripts/bedrock-gameplay-bridge.cjs" "$temp/bedrock-gameplay-bridge.cjs"
cp "$root/scripts/bedrock-player-input.cjs" "$temp/bedrock-player-input.cjs"
cp "$root/scripts/bedrock-terrain-cache.cjs" "$temp/bedrock-terrain-cache.cjs"
cp "$root/scripts/bedrock-runtime-registry.cjs" "$temp/bedrock-runtime-registry.cjs"
cp "$root/scripts/bedrock-local-path.cjs" "$temp/bedrock-local-path.cjs"
# Keep original TypeScript gameplay modules as ESM with their relative imports.
# This folder is staged inside the SAME Node Bedrock session bundle.
mkdir -p "$temp/gameplay"
cp "$root/dist/src/gameplay/navigation-authority.js" "$temp/gameplay/navigation-authority.js"
cp "$root/dist/src/gameplay/companion-engine.js" "$temp/gameplay/companion-engine.js"
cp "$root/dist/src/gameplay/layer-one.js" "$temp/gameplay/layer-one.js"
cp "$root/dist/src/gameplay/layer-two.js" "$temp/gameplay/layer-two.js"
cp "$root/dist/src/gameplay/layer-three.js" "$temp/gameplay/layer-three.js"
cp "$root/dist/src/gameplay/layer-four.js" "$temp/gameplay/layer-four.js"
cp "$root/dist/src/gameplay/layer-five.js" "$temp/gameplay/layer-five.js"
cp "$root/dist/src/gameplay/layer-six.js" "$temp/gameplay/layer-six.js"
cp "$root/dist/src/gameplay/layer-seven.js" "$temp/gameplay/layer-seven.js"
cp "$root/dist/src/gameplay/companion-skill-policy.js" "$temp/gameplay/companion-skill-policy.js"
cp "$root/dist/src/gameplay/layer-eight.js" "$temp/gameplay/layer-eight.js"
cp "$root/dist/src/gameplay/addon-navigation.js" "$temp/gameplay/addon-navigation.js"
printf '{"type":"module"}\n' > "$temp/gameplay/package.json"
cp "$root/dist/src/connection/prismarine-world-client.js" "$temp/prismarine-world-client.mjs"
cp "$root/dist/src/core/bot-awareness.js" "$temp/bot-awareness.mjs"
cp "$root/scripts/android-friend-world-session.test.cjs" "$temp/friend-world-session.test.cjs"
cp "$root/scripts/bedrock-gameplay-bridge.test.cjs" "$temp/bedrock-gameplay-bridge.test.cjs"

python3 - "$temp" <<'PY'
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import sys

runtime = Path(sys.argv[1])
zip_path = runtime / "bedrock-sdk.zip"
with ZipFile(zip_path, "w", ZIP_DEFLATED) as archive:
    for entrypoint in (
        "node-smoke.cjs", "xbox-auth-probe.cjs", "friend-world-session.cjs",
        "bedrock-gameplay-bridge.cjs", "bedrock-player-input.cjs",
        "prismarine-world-client.mjs", "bot-awareness.mjs",
    ):
        archive.write(runtime / entrypoint, entrypoint)
    for source in sorted((runtime / "gameplay").rglob("*")):
        if source.is_file():
            archive.write(source, source.relative_to(runtime))
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
cp "$temp/bedrock-gameplay-bridge.test.cjs" "$temp/verify/"
node --test "$temp/verify/friend-world-session.test.cjs" "$temp/verify/bedrock-gameplay-bridge.test.cjs"
mkdir -p "$destination"
cp "$temp/bedrock-sdk.zip" "$destination/bedrock-sdk.zip"
du -h "$destination/bedrock-sdk.zip"
