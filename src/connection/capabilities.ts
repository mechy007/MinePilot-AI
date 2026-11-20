export type TransportCapability = 'microsoft_auth' | 'xbox_friend_discovery' | 'bedrock_join' | 'spawn_confirmation';
export const REQUIRED_CONNECTION_CAPABILITIES: readonly TransportCapability[] = Object.freeze([
  'microsoft_auth', 'xbox_friend_discovery', 'bedrock_join', 'spawn_confirmation'
]);
export type TransportCapabilityReport = Readonly<Record<TransportCapability, boolean>>;
export const UNIMPLEMENTED_TRANSPORT_CAPABILITIES: TransportCapabilityReport = Object.freeze({
  microsoft_auth: false,
  xbox_friend_discovery: false,
  bedrock_join: false,
  spawn_confirmation: false
});
export function missingConnectionCapabilities(report: TransportCapabilityReport): readonly TransportCapability[] {
  return REQUIRED_CONNECTION_CAPABILITIES.filter(capability => report[capability] !== true);
}
export function assertLiveConnectionSupported(report: TransportCapabilityReport): void {
  const missing = missingConnectionCapabilities(report);
  if (missing.length > 0) throw new Error('Live Bedrock connection unavailable: ' + missing.join(', '));
}
