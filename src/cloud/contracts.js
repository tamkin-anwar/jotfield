export const SYNC_PROTOCOL_VERSION = 1;

export function makeSyncEnvelope(kind, payload) {
  return {
    protocol: SYNC_PROTOCOL_VERSION,
    id: crypto.randomUUID(),
    kind,
    createdAt: new Date().toISOString(),
    payload,
  };
}

export function isSyncEnvelope(value) {
  return Boolean(
    value
      && value.protocol === SYNC_PROTOCOL_VERSION
      && typeof value.id === 'string'
      && typeof value.kind === 'string'
      && typeof value.createdAt === 'string'
      && value.payload,
  );
}
