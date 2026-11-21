import { createRequire } from 'node:module';

export interface FriendWorldRuntimeStatus {
  nodeSupported: boolean;
  sdkInstalled: boolean;
  sdkHasCreateClient: boolean;
  androidEmbedded: false;
  readyForNodeJoinAttempt: boolean;
  issues: string[];
}

/** Diagnose the SDK separately from mocked protocol tests. No credentials are read. */
export function checkFriendWorldRuntime(
  nodeMajor: number,
  loadSdk: () => unknown = () => createRequire(import.meta.url)('bedrock-protocol')
): FriendWorldRuntimeStatus {
  const nodeSupported = Number.isInteger(nodeMajor) && nodeMajor >= 24;
  const issues: string[] = [];
  if (!nodeSupported) issues.push('Node.js 24 or newer required for upstream bedrock-protocol');
  let sdkInstalled = false;
  let sdkHasCreateClient = false;
  try {
    const sdk = loadSdk() as { createClient?: unknown } | null;
    sdkInstalled = true;
    sdkHasCreateClient = typeof sdk?.createClient === 'function';
    if (!sdkHasCreateClient) issues.push('bedrock-protocol missing createClient API');
  } catch (error) {
    issues.push('bedrock-protocol unavailable: ' + (error instanceof Error ? error.message : 'unknown load error'));
  }
  issues.push('Android embedded runtime not installed; Node runtime check does not validate Android');
  return { nodeSupported, sdkInstalled, sdkHasCreateClient, androidEmbedded: false,
    readyForNodeJoinAttempt: nodeSupported && sdkHasCreateClient, issues };
}
