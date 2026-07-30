const AUTO_COLLECT_ENABLED_KEY = 'autoCollectEnabled';
const COLLECTED_JOB_COUNT_KEY = 'collectedJobCount';

const toggleEl = document.getElementById('auto-collect-toggle') as HTMLInputElement;
const toggleStateEl = document.getElementById('toggle-state') as HTMLSpanElement;
const countEl = document.getElementById('collected-count') as HTMLSpanElement;

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
