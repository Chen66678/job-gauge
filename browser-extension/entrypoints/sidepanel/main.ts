import {
  AUTO_COLLECT_ENABLED_KEY,
  COLLECTION_RECORDS_KEY,
  DETAIL_PANEL_STATUS_KEY,
  CURRENT_VIEWED_JOB_ID_KEY,
  COLLECTED_JOB_IDS_KEY,
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
const copyButtonEl = document.getElementById('copy-image-button') as HTMLButtonElement;
const copyStatusEl = document.getElementById('copy-image-status') as HTMLDivElement;

type CopyImageStatus = 'idle' | 'loading' | 'success' | 'failure';
type ResumeImageRequest = { type: 'RESUME_IMAGE_REQUESTED'; jobId: string };
type ResumeImageResponse =
  | { ok: true; mimeType: string; dataBase64: string }
  | { ok: false; error: string };

function renderCopyImageStatus(status: CopyImageStatus, message = '') {
  copyStatusEl.className = status;
  if (status === 'idle') {
    copyStatusEl.textContent = '点击按钮后可将简历图片复制到剪贴板';
  } else if (status === 'loading') {
    copyStatusEl.textContent = '正在获取简历图片并写入剪贴板…';
  } else if (status === 'success') {
    copyStatusEl.textContent = '已复制简历图片到剪贴板，可直接粘贴验证';
  } else {
    copyStatusEl.textContent = message || '复制失败，请检查网络、token 或剪贴板权限';
  }
}

async function resolveCurrentJobId(): Promise<string | null> {
  const stored = await chrome.storage.local.get([
    CURRENT_VIEWED_JOB_ID_KEY,
    COLLECTION_RECORDS_KEY,
    COLLECTED_JOB_IDS_KEY,
  ]);
  if (typeof stored[CURRENT_VIEWED_JOB_ID_KEY] === 'string' && stored[CURRENT_VIEWED_JOB_ID_KEY].trim()) {
    return stored[CURRENT_VIEWED_JOB_ID_KEY].trim();
  }
  const records = parseCollectionRecords(stored[COLLECTION_RECORDS_KEY]);
  for (const record of records) {
    if (typeof record.jobId === 'string' && record.jobId.trim()) {
      return record.jobId.trim();
    }
  }
  const ids = stored[COLLECTED_JOB_IDS_KEY];
  if (Array.isArray(ids)) {
    const last = [...ids].reverse().find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    return last?.trim() ?? null;
  }
  return null;
}

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
  renderCopyImageStatus('idle');

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

  copyButtonEl.addEventListener('click', async () => {
    const jobId = await resolveCurrentJobId();
    if (!jobId) {
      renderCopyImageStatus('failure', '未获取到 jobId，无法复制图片');
      return;
    }
    copyButtonEl.disabled = true;
    renderCopyImageStatus('loading');
    try {
      const response = await chrome.runtime.sendMessage<ResumeImageRequest, ResumeImageResponse>({
        type: 'RESUME_IMAGE_REQUESTED',
        jobId,
      });
      if (!response || !response.ok) {
        throw new Error(response?.error || '未能获取简历图片');
      }
      const binary = atob(response.dataBase64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const blob = new Blob([bytes], { type: response.mimeType || 'image/png' });
      if (typeof ClipboardItem === 'undefined') {
        throw new Error('当前环境不支持 ClipboardItem');
      }
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type || 'image/png']: blob }),
      ]);
      renderCopyImageStatus('success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      renderCopyImageStatus('failure', `复制失败：${message}`);
    } finally {
      copyButtonEl.disabled = false;
    }
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
