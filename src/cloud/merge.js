const itemTime = (item) => new Date(item?.updated || item?.created || 0).getTime() || 0;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export const recordSignature = (record) => JSON.stringify(stableValue(record));

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function newer(first, second) {
  return itemTime(first) >= itemTime(second) ? first : second;
}

function tombstoneMap(...groups) {
  const result = new Map();
  groups.flat().filter(Boolean).forEach((entry) => {
    const id = entry.id || `${entry.kind}:${entry.recordId}`;
    const normalized = { ...entry, id };
    const current = result.get(id);
    if (!current || itemTime({ updated: normalized.deletedAt }) >= itemTime({ updated: current.deletedAt })) result.set(id, normalized);
  });
  return result;
}

function conflictCopy(record, sourceId, opposingRecord) {
  const fingerprint = hash(`${sourceId}|${recordSignature(record)}|${recordSignature(opposingRecord)}`);
  return {
    ...structuredClone(record),
    id: `conflict-${sourceId}-${fingerprint}`,
    title: `${record.title || 'Untitled'} (conflict copy)`,
    conflictOf: sourceId,
    conflictKey: fingerprint,
    created: record.created || new Date(0).toISOString(),
    updated: record.updated || record.created || new Date(0).toISOString(),
  };
}

function mergeRecords(local = [], remote = [], base = [], kind) {
  const left = new Map(local.map((item) => [item.id, item]));
  const right = new Map(remote.map((item) => [item.id, item]));
  const common = new Map(base.map((item) => [item.id, item]));
  const result = new Map();
  const conflictCopies = [];
  const ids = new Set([...left.keys(), ...right.keys(), ...common.keys()]);

  ids.forEach((id) => {
    const localItem = left.get(id);
    const remoteItem = right.get(id);
    const baseItem = common.get(id);
    if (!localItem && !remoteItem) return;
    if (!localItem) { result.set(id, remoteItem); return; }
    if (!remoteItem) { result.set(id, localItem); return; }

    const localSignature = recordSignature(localItem);
    const remoteSignature = recordSignature(remoteItem);
    if (localSignature === remoteSignature) { result.set(id, localItem); return; }

    const localChanged = baseItem ? localSignature !== recordSignature(baseItem) : false;
    const remoteChanged = baseItem ? remoteSignature !== recordSignature(baseItem) : false;
    const winner = newer(localItem, remoteItem);
    result.set(id, winner);

    if (kind === 'note' && baseItem && localChanged && remoteChanged) {
      const loser = winner === localItem ? remoteItem : localItem;
      conflictCopies.push(conflictCopy(loser, id, winner));
    }
  });

  conflictCopies.forEach((copy) => {
    const alreadyPresent = [...result.values()].some((item) => item.conflictKey === copy.conflictKey);
    if (!alreadyPresent) result.set(copy.id, copy);
  });
  return [...result.values()];
}

function applyTombstones(records, tombstones, kind) {
  return records.filter((record) => {
    const tombstone = tombstones.get(`${kind}:${record.id}`);
    return !tombstone || itemTime(record) > new Date(tombstone.deletedAt || 0).getTime();
  });
}

export function mergeNotebookVersions(local = {}, remote = {}, base = null) {
  const common = base || {};
  const tombstones = tombstoneMap(local.tombstones, remote.tombstones, common.tombstones);
  const notes = applyTombstones(mergeRecords(local.notes, remote.notes, common.notes, 'note'), tombstones, 'note');
  const tasks = applyTombstones(mergeRecords(local.tasks, remote.tasks, common.tasks, 'task'), tombstones, 'task');
  const spaces = mergeRecords(local.spaces, remote.spaces, common.spaces, 'space');
  return {
    notes,
    tasks,
    spaces,
    tombstones: [...tombstones.values()],
    modifiedAt: new Date(local.modifiedAt || 0) >= new Date(remote.modifiedAt || 0) ? local.modifiedAt : remote.modifiedAt,
  };
}

export function deletionTombstone(kind, recordId, deletedAt = new Date().toISOString()) {
  return { id: `${kind}:${recordId}`, kind, recordId, deletedAt };
}
