'use strict';

const assert = require('node:assert/strict');
const { createECDH } = require('node:crypto');
const { createSocket } = require('node:dgram');

assert.equal(process.versions.node.split('.')[0], '24');
assert.equal(typeof fetch, 'function');
assert.equal(typeof WebSocket, 'function');
assert.ok(createECDH('prime256v1').generateKeys().length > 0);

const socket = createSocket('udp4');
const payload = Buffer.from('minepilot');
const timeout = setTimeout(() => finish(new Error('UDP loopback timed out')), 5000);

function finish(error) {
  clearTimeout(timeout);
  if (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  socket.close();
}

socket.once('error', finish);
socket.once('message', message => {
  finish(message.equals(payload) ? undefined : new Error('UDP loopback payload mismatch'));
});
socket.bind(0, '127.0.0.1', () => {
  socket.send(payload, socket.address().port, '127.0.0.1', error => {
    if (error) finish(error);
  });
});
