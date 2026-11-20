export interface ConnectionConfig {
  readonly ownerXuid: string;
  readonly accountLabel?: string;
}
export function parseConnectionConfig(value: unknown): Readonly<ConnectionConfig> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Connection config must be an object');
  const input = value as Record<string, unknown>;
  const allowed = new Set(['ownerXuid', 'accountLabel']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new Error('Unknown connection config field');
  if (typeof input.ownerXuid !== 'string' || !/^[0-9]{1,20}$/.test(input.ownerXuid)) {
    throw new Error('Owner XUID must contain 1 to 20 decimal digits');
  }
  const numericXuid = BigInt(input.ownerXuid);
  if (numericXuid === 0n || numericXuid > 18446744073709551615n) throw new Error('Owner XUID out of range');
  if (input.accountLabel !== undefined && (typeof input.accountLabel !== 'string' ||
      input.accountLabel.length > 64 || !/^[a-zA-Z0-9 _.-]*$/.test(input.accountLabel))) {
    throw new Error('Invalid account label');
  }
  return Object.freeze({
    ownerXuid: input.ownerXuid,
    ...(input.accountLabel === undefined ? {} : { accountLabel: input.accountLabel as string })
  });
}
