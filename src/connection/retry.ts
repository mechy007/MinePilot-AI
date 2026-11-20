export interface RetryPolicy { initialDelayMs: number; maxDelayMs: number; maxAttempts: number }
export const DEFAULT_RETRY_POLICY: Readonly<RetryPolicy> = Object.freeze({
  initialDelayMs: 1000, maxDelayMs: 30000, maxAttempts: 6
});
export function retryDelay(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number | null {
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError('Attempt must be a positive integer');
  if (!Number.isSafeInteger(policy.maxAttempts) || policy.maxAttempts < 1 ||
      !Number.isFinite(policy.initialDelayMs) || policy.initialDelayMs <= 0 ||
      !Number.isFinite(policy.maxDelayMs) || policy.maxDelayMs < policy.initialDelayMs) {
    throw new RangeError('Invalid retry policy');
  }
  if (attempt > policy.maxAttempts) return null;
  return Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** Math.min(attempt - 1, 53));
}
export async function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new RangeError('Invalid delay');
  if (signal.aborted) throw new Error('Retry cancelled');
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); resolve(); }, delayMs);
    const onAbort = () => { clearTimeout(timeout); cleanup(); reject(new Error('Retry cancelled')); };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
