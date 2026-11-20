import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const pkg = require('bedrock-protocol/package.json');
assert.equal(pkg.version, '3.61.0');
const protocol = require('bedrock-protocol');
assert.equal(typeof protocol.createClient, 'function');
console.log('Bedrock SDK load smoke passed; no Xbox authentication or Minecraft join attempted');
