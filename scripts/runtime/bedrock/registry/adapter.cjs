'use strict';
const NAME = /^minecraft:[a-z0-9_./-]{1,96}$/;
const MAX_ENTRIES = 131072;
const MAX_ID = 0xffffffff;
function entriesOf(input) {
  if (input instanceof Map) return [...input.entries()];
  if (Array.isArray(input)) return input.slice(0, MAX_ENTRIES).map(e => Array.isArray(e) ? e : [e?.runtimeId ?? e?.id, e]);
  if (input && typeof input === 'object') {
    const source = input.blocksByRuntimeId ?? input.byRuntimeId ?? input;
    if (source instanceof Map) return [...source.entries()];
    return Object.entries(source).slice(0, MAX_ENTRIES);
  }
  return [];
}
function normalizeExternalRegistry(input, metadata = {}) {
  const rejected = reason => ({ status: 'rejected', reason, compatible: false, registry: new Map(), entries: 0 });
  if (metadata.verified !== true) return rejected('independent_registry_requires_explicit_fixture_verification');
  if (metadata.gameVersion !== '1.26.60' || metadata.protocol !== 2225)
    return rejected('registry_version_does_not_match_current_codec_baseline');
  if (typeof metadata.hashed !== 'boolean') return rejected('registry_hash_mode_required');
  const sourceEntries = entriesOf(input);
  if (!sourceEntries.length || sourceEntries.length > MAX_ENTRIES) return rejected('invalid_registry_size');
  const registry = new Map();
  for (const [rawId, rawValue] of sourceEntries) {
    const id = typeof rawId === 'string' && /^[0-9]{1,10}$/.test(rawId) ? Number(rawId) : rawId;
    const value = typeof rawValue === 'string' ? { name: rawValue } : rawValue;
    if (!Number.isSafeInteger(id) || id < 0 || id > MAX_ID || !value || typeof value !== 'object') continue;
    const name = typeof value.name === 'string' && value.name.includes(':') ? value.name :
      typeof value.name === 'string' ? 'minecraft:' + value.name : null;
    if (!name || !NAME.test(name) || registry.has(id)) continue;
    registry.set(id, { name,
      boundingBox: ['block','empty',null].includes(value.boundingBox) ? value.boundingBox : null,
      fullCube: value.collisionVerified === true && typeof value.fullCube === 'boolean' ? value.fullCube : null });
  }
  if (!registry.size) return rejected('no_valid_registry_entries');
  return { status: 'cross_check_ready', compatible: false, liveMovementAuthority: false,
    reason: 'reference_registry_only_not_a_live_authority',
    source: String(metadata.source ?? 'external').slice(0,64), gameVersion: metadata.gameVersion,
    protocol: metadata.protocol, hashed: metadata.hashed, registry, entries: registry.size };
}
function compareRegistries(primary, secondary, options = {}) {
  if (!(primary instanceof Map) || !(secondary instanceof Map))
    return { status: 'rejected', reason: 'maps_required', compared: 0, mismatches: [] };
  const max = Math.max(1, Math.min(8192, options.maxMismatches ?? 64));
  let compared = 0; const mismatches = [];
  for (const [id, expected] of primary) {
    if (!secondary.has(id)) { if (mismatches.length < max) mismatches.push({ id, field: 'missing_in_reference' }); continue; }
    const actual = secondary.get(id); compared++;
    for (const field of ['name','boundingBox']) if ((expected?.[field] ?? null) !== (actual?.[field] ?? null) &&
      mismatches.length < max) mismatches.push({ id, field, primary: expected?.[field] ?? null, reference: actual?.[field] ?? null });
  }
  return { status: mismatches.length ? 'mismatch' : 'matched_subset', compared,
    primaryEntries: primary.size, referenceEntries: secondary.size, mismatches, truncated: mismatches.length >= max };
}
module.exports = { normalizeExternalRegistry, compareRegistries };
