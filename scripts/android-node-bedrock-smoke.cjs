'use strict';

const assert = require('node:assert/strict');
const { createECDH } = require('node:crypto');
const { createSocket } = require('node:dgram');

function checkUdpLoopback() {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    const payload = Buffer.from('minepilot');
    const timeout = setTimeout(() => finish(new Error('UDP loopback timed out')), 5000);
    let finished = false;

    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      socket.close();
      if (error) reject(error);
      else resolve();
    }

    socket.on('error', finish);
    socket.once('message', message => {
      finish(message.equals(payload) ? undefined : new Error('UDP loopback payload mismatch'));
    });
    socket.bind(0, '127.0.0.1', () => {
      socket.send(payload, socket.address().port, '127.0.0.1', error => {
        if (error) finish(error);
      });
    });
  });
}

async function checkBedrockSdk() {
  assert.equal(process.versions.node.split('.')[0], '24');
  assert.equal(typeof fetch, 'function');
  assert.equal(typeof WebSocket, 'function');
  assert.ok(createECDH('prime256v1').generateKeys().length > 0);
  await checkUdpLoopback();

  process.env.HOME ??= __dirname;
  const bedrock = require('bedrock-protocol');
  const { createSerializer, createDeserializer } = require('bedrock-protocol/src/transforms/serializer');
  const { Authflow } = require('prismarine-auth');
  const { XboxClient } = require('prismarine-xbox-services');
  const { getWebRTC } = require('nethernet/src/webrtc');
  assert.equal(typeof bedrock.createClient, 'function');
  assert.equal(typeof Authflow, 'function');
  assert.equal(typeof XboxClient, 'function');

  const version = '1.26.60';
  const protocol = require('minecraft-data')('bedrock_' + version).version.version;
  assert.equal(protocol, 2225);
  const packet = createSerializer(version).createPacketBuffer({
    name: 'request_network_settings',
    params: { client_protocol: protocol }
  });
  assert.equal(createDeserializer(version).parsePacketBuffer(packet).data.params.client_protocol, protocol);

  const { RTCPeerConnection } = getWebRTC('werift');
  const peer = new RTCPeerConnection();
  try {
    peer.createDataChannel('runtime-probe');
    assert.equal((await peer.createOffer()).type, 'offer');
  } finally {
    await peer.close();
  }
}

checkBedrockSdk().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
