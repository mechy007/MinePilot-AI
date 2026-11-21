import { FriendWorldJoinRunner } from './friend-world-join-runner.js';

const username = process.env.MINEPILOT_XBOX_USERNAME ?? '';
const friendOwnerXuid = process.env.MINEPILOT_FRIEND_XUID ?? '';
if (!username || !friendOwnerXuid) {
  process.stderr.write('Set MINEPILOT_XBOX_USERNAME and MINEPILOT_FRIEND_XUID. Do not put passwords or tokens in environment variables.\\n');
  process.exitCode = 2;
} else {
  const runner = new FriendWorldJoinRunner({ username, friendOwnerXuid }, event => {
    process.stdout.write(JSON.stringify(event) + '\\n');
  }, undefined, code => {
    if (code.verification_uri && code.user_code) {
      process.stdout.write('Microsoft sign-in: ' + code.verification_uri + ' code: ' + code.user_code + '\\n');
    } else if (code.message) process.stdout.write(code.message + '\\n');
  });
  const stop = () => { runner.stop(); process.exitCode = 0; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  runner.start().catch(error => {
    process.stderr.write('Join failed: ' + (error instanceof Error ? error.message : 'unknown error') + '\\n');
    process.exitCode = 1;
    runner.stop();
  });
}
