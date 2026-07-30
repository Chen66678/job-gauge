export const AUTO_COLLECT_ENABLED_KEY = 'autoCollectEnabled';
export const COLLECTED_JOB_IDS_KEY = 'collectedJobIds';
export const COLLECTED_JOB_COUNT_KEY = 'collectedJobCount';
export const COLLECTION_RECORDS_KEY = 'collectionRecords';
export const DETAIL_PANEL_STATUS_KEY = 'detailPanelStatus';

export type CollectionRecord = {
  attemptedAt: string;
  title: string;
  result: 'success' | 'failure';
  error?: string;
  jobId?: string;
  jobIdSource?: string;
};

const MAX_COLLECTION_RECORDS = 25;
let recordWriteQueue: Promise<void> = Promise.resolve();

export function parseCollectionRecords(value: unknown): CollectionRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is CollectionRecord => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    const record = item as Partial<CollectionRecord>;
    return typeof record.attemptedAt === 'string'
      && typeof record.title === 'string'
      && (record.result === 'success' || record.result === 'failure')
      && (record.error === undefined || typeof record.error === 'string')
      && (record.jobId === undefined || typeof record.jobId === 'string')
      && (record.jobIdSource === undefined || typeof record.jobIdSource === 'string');
  });
}

export function appendCollectionRecord(record: CollectionRecord): Promise<void> {
  const write = recordWriteQueue.then(async () => {
    const stored = await chrome.storage.local.get(COLLECTION_RECORDS_KEY);
    const records = parseCollectionRecords(stored[COLLECTION_RECORDS_KEY]);
    records.unshift(record);
    await chrome.storage.local.set({
      [COLLECTION_RECORDS_KEY]: records.slice(0, MAX_COLLECTION_RECORDS),
    });
  });
  recordWriteQueue = write.catch(() => undefined);
  return write;
}
