import { ConnectionController, type ConnectionDriver } from './controller.js';
import { assertLiveConnectionSupported, type TransportCapabilityReport, UNIMPLEMENTED_TRANSPORT_CAPABILITIES } from './capabilities.js';
import { type RetryPolicy, DEFAULT_RETRY_POLICY } from './retry.js';

/**
 * Production-only entry point. The mock controller remains available to tests,
 * but callers must explicitly provide a fully implemented capability report.
 * This declaration is a readiness check, not proof of network interoperability.
 */
export function createLiveConnectionController(
  driver: ConnectionDriver,
  capabilities: TransportCapabilityReport = UNIMPLEMENTED_TRANSPORT_CAPABILITIES,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY
): ConnectionController {
  assertLiveConnectionSupported(capabilities);
  return new ConnectionController(driver, retryPolicy);
}
