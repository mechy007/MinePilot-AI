import { checkFriendWorldRuntime } from './friend-world-runtime-check.js';
const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
const status = checkFriendWorldRuntime(major);
process.stdout.write(JSON.stringify(status, null, 2) + '\n');
if (!status.readyForNodeJoinAttempt) process.exitCode = 1;
