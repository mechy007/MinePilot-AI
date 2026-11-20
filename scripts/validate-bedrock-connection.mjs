import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const live = process.argv.includes('--live');
const dry = process.argv.includes('--dry-run');
if (live === dry) {
  console.error('Choose exactly one mode: --dry-run or --live');
  process.exitCode = 2;
} else if (dry) {
  const { createClient } = require('bedrock-protocol');
  if (typeof createClient !== 'function') throw new Error('SDK createClient missing');
  console.log('PASS: SDK load and client API available. No Xbox login or Minecraft join attempted.');
} else {
  const ownerXuid = process.env.MINEPILOT_OWNER_XUID;
  const botLabel = process.env.MINEPILOT_BOT_LABEL;
  if (!ownerXuid || !/^\d+$/.test(ownerXuid) || !botLabel || botLabel.trim() !== botLabel) {
    console.error('Set MINEPILOT_OWNER_XUID (decimal) and MINEPILOT_BOT_LABEL (nonempty, trimmed).');
    process.exit(2);
  }
  const { PrismarineWorldClient } = await import('../dist/src/connection/prismarine-world-client.js');
  const profilesFolder = resolve(process.env.MINEPILOT_AUTH_CACHE || '.minepilot-private-auth');
  await mkdir(profilesFolder, { recursive: true, mode: 0o700 });
  const aborter = new AbortController();
  const timeout = setTimeout(() => aborter.abort(), 180_000);
  const bot = new PrismarineWorldClient(botLabel, ownerXuid, undefined, {
    profilesFolder,
    onMsaCode: code => {
      // Device code is a short-lived authentication secret. Only display locally,
      // never in GitHub Actions logs or uploaded artifacts.
      if (process.env.GITHUB_ACTIONS === 'true') {
        console.error('Interactive device authorization is disabled in GitHub Actions.');
        aborter.abort();
        return;
      }
      console.log('Open Microsoft device sign-in URL:', code.verification_uri || 'https://www.microsoft.com/link');
      console.log('Enter the device code shown by your Microsoft sign-in flow.');
      if (code.user_code) process.stdout.write('Device code (local terminal only): ' + code.user_code + '\n');
    }
  });
  const stop = () => aborter.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    console.log('Attempting Xbox authentication and owner-world join. Timeout: 180s.');
    await bot.connectAndSpawn(aborter.signal);
    console.log('PASS: spawn event received. Verify bot is visible in the owner world.');
  } catch (error) {
    console.error('FAIL: login, discovery, join, or spawn did not complete:', error instanceof Error ? error.message : 'unknown error');
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    bot.disconnect();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
