import {
  AUTO_COLLECT_ENABLED_KEY,
  COLLECTION_RECORDS_KEY,
  DETAIL_PANEL_STATUS_KEY,
  parseCollectionRecords,
  resetSessionCollectedCount,
  SESSION_COLLECTED_JOB_COUNT_KEY,
  type CollectionRecord,
} from '../shared/collectionState';

const toggleEl = document.getElementById('auto-collect-toggle') as HTMLInputElement;
const toggleStateEl = document.getElementById('toggle-state') as HTMLSpanElement;
const countEl = document.getElementById('collected-count') as HTMLSpanElement;
const recordsEl = document.getElementById('records') as HTMLDivElement;
const emptyStateEl = document.getElementById('empty-state') as HTMLDivElement;
const panelStatusEl = document.getElementById('panel-status') as HTMLDivElement;

// Three real states, not two: 'detected', 'not-detected', and undefined
// (content script hasn't reported anything yet — e.g. just injected and
// still initializing, or an older build predating this key). Collapsing
// undefined into the same rendering as 'detected' is exactly the class of
// bug that made the search-results page look silently idle instead of
// visibly broken.
function renderPanelStatus(value: unknown) {
  if (value === 'not-detected') {
    panelStatusEl.className = 'not-detected';
    panelStatusEl.textContent = '当前页面未检测到岗位详情，请在左侧列表点选一个岗位';
  } else if (value === 'detected') {
    panelStatusEl.className = 'detected';
    panelStatusEl.textContent = '';
  } else {
    panelStatusEl.className = 'unknown';
    panelStatusEl.textContent = '尚未收到页面状态，请确认已打开 BOSS 直聘职位页';
  }
}

function renderToggle(enabled: boolean) {
  toggleEl.checked = enabled;
  toggleStateEl.textContent = enabled ? 'ON' : 'OFF';
  toggleStateEl.className = enabled ? 'enabled' : 'disabled';
}

function renderCount(value: unknown) {
  countEl.textContent = typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : '0';
}

function formatAttemptTime(attemptedAt: string): string {
  const date = new Date(attemptedAt);
  if (Number.isNaN(date.getTime())) {
    return attemptedAt;
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function createRecordElement(record: CollectionRecord): HTMLDivElement {
  const recordEl = document.createElement('div');
  recordEl.className = `record ${record.result}`;

  const headEl = document.createElement('div');
  headEl.className = 'record-head';

  const resultEl = document.createElement('span');
  resultEl.className = 'result';
  resultEl.textContent = record.result === 'success' ? '成功' : '失败';

  const timeEl = document.createElement('time');
  timeEl.className = 'time';
  timeEl.dateTime = record.attemptedAt;
  timeEl.textContent = formatAttemptTime(record.attemptedAt);
  headEl.append(resultEl, timeEl);

  const titleEl = document.createElement('div');
  titleEl.className = record.title ? 'title' : 'title empty';
  titleEl.textContent = record.title || '未读取到岗位标题';

  recordEl.append(headEl, titleEl);
  if (record.result === 'failure' && record.error) {
    const errorEl = document.createElement('div');
    errorEl.className = 'error';
    errorEl.textContent = record.error;
    recordEl.append(errorEl);
  }
  return recordEl;
}

function renderRecords(value: unknown) {
  const records = parseCollectionRecords(value);
  recordsEl.replaceChildren(...records.map(createRecordElement));
  emptyStateEl.hidden = records.length > 0;
}

async function init() {
  const stored = await chrome.storage.local.get([
    AUTO_COLLECT_ENABLED_KEY,
    COLLECTION_RECORDS_KEY,
    DETAIL_PANEL_STATUS_KEY,
  ]);
  const enabled = stored[AUTO_COLLECT_ENABLED_KEY] !== false;
  renderToggle(enabled);
  renderRecords(stored[COLLECTION_RECORDS_KEY]);
  renderPanelStatus(stored[DETAIL_PANEL_STATUS_KEY]);

  if (stored[AUTO_COLLECT_ENABLED_KEY] === undefined) {
    await chrome.storage.local.set({ [AUTO_COLLECT_ENABLED_KEY]: true });
  }

  // The sidebar is the surface that actually stays open while the user
  // works, so "opening it" — not opening the popup — is the real "this
  // round starts now" moment. Reset happens here, not in popup/main.ts.
  renderCount(0);
  await resetSessionCollectedCount();

  toggleEl.addEventListener('change', async () => {
    const nextEnabled = toggleEl.checked;
    renderToggle(nextEnabled);
    await chrome.storage.local.set({ [AUTO_COLLECT_ENABLED_KEY]: nextEnabled });
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }
    if (changes[AUTO_COLLECT_ENABLED_KEY]) {
      renderToggle(changes[AUTO_COLLECT_ENABLED_KEY].newValue !== false);
    }
    if (changes[SESSION_COLLECTED_JOB_COUNT_KEY]) {
      renderCount(changes[SESSION_COLLECTED_JOB_COUNT_KEY].newValue);
    }
    if (changes[COLLECTION_RECORDS_KEY]) {
      renderRecords(changes[COLLECTION_RECORDS_KEY].newValue);
    }
    if (changes[DETAIL_PANEL_STATUS_KEY]) {
      renderPanelStatus(changes[DETAIL_PANEL_STATUS_KEY].newValue);
    }
  });
}

void init();
