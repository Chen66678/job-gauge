import {
  AUTO_COLLECT_ENABLED_KEY,
  COLLECTED_JOB_COUNT_KEY,
} from '../shared/collectionState';

const toggleEl = document.getElementById('auto-collect-toggle') as HTMLInputElement;
const toggleStateEl = document.getElementById('toggle-state') as HTMLSpanElement;
const countEl = document.getElementById('collected-count') as HTMLSpanElement;
const openSidepanelEl = document.getElementById('open-sidepanel') as HTMLButtonElement;
const openSidepanelErrorEl = document.getElementById('open-sidepanel-error') as HTMLDivElement;

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

async function init() {
  const stored = await chrome.storage.local.get([
    AUTO_COLLECT_ENABLED_KEY,
    COLLECTED_JOB_COUNT_KEY,
  ]);
  const enabled = stored[AUTO_COLLECT_ENABLED_KEY] !== false;
  renderToggle(enabled);
  renderCount(stored[COLLECTED_JOB_COUNT_KEY]);

  if (stored[AUTO_COLLECT_ENABLED_KEY] === undefined) {
    await chrome.storage.local.set({ [AUTO_COLLECT_ENABLED_KEY]: true });
  }

  toggleEl.addEventListener('change', async () => {
    const nextEnabled = toggleEl.checked;
    renderToggle(nextEnabled);
    await chrome.storage.local.set({ [AUTO_COLLECT_ENABLED_KEY]: nextEnabled });
  });

  openSidepanelEl.addEventListener('click', async () => {
    openSidepanelErrorEl.textContent = '';
    try {
      const currentWindow = await chrome.windows.getCurrent();
      if (currentWindow.id === undefined) {
        throw new Error('未能识别当前浏览器窗口');
      }
      await chrome.sidePanel.open({ windowId: currentWindow.id });
      window.close();
    } catch (error) {
      openSidepanelErrorEl.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }
    if (changes[AUTO_COLLECT_ENABLED_KEY]) {
      renderToggle(changes[AUTO_COLLECT_ENABLED_KEY].newValue !== false);
    }
    if (changes[COLLECTED_JOB_COUNT_KEY]) {
      renderCount(changes[COLLECTED_JOB_COUNT_KEY].newValue);
    }
  });
}

void init();
