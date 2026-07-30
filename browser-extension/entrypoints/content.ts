// Content script for BOSS Zhipin job pages.
//
// READ-ONLY CONTRACT: this script reads DOM text and only injects/removes its
// own passive "已采集" marker. It never clicks, submits, focuses, navigates,
// or changes page controls. The
// two-column recommendation page (`/web/geek/jobs`) renders the right-hand
// job detail panel only after the user clicks a card in the left-hand list
// themselves; this script never simulates that click, it only reads the
// panel after the user changes the selected job themselves.
//
// Selector notes: BOSS Zhipin's markup changes between deployments and
// injects hidden noise text (zero-size spans plus a matching inline
// <style>) into the description to poison naive scrapers. Each field below
// tries several known/likely selectors in order (most specific first) and
// falls back gracefully so the extension degrades instead of throwing when
// the DOM doesn't match. Selectors scoped under `.job-detail-container`
// target the two-column recommendation page; unscoped selectors are legacy
// fallbacks for the standalone `/job_detail/*` page.

export interface JdPayload {
  title: string;
  company: string;
  description: string;
  workAddress: string | null;
  sourceUrl: string | null;
}

import {
  appendCollectionRecord,
  AUTO_COLLECT_ENABLED_KEY,
  COLLECTED_JOB_COUNT_KEY,
  COLLECTED_JOB_IDS_KEY,
  type CollectionRecord,
} from './shared/collectionState';

type BackgroundResult = { ok: true } | { ok: false; error: string };

const COLLECTED_MARKER_ATTRIBUTE = 'data-job-hq-collected-marker';
const DETAIL_PANEL_SELECTOR = '.job-detail-container';
const DETAIL_TITLE_SELECTOR = `${DETAIL_PANEL_SELECTOR} .job-name`;
const AUTO_COLLECT_DEBOUNCE_MS = 250;

let autoCollectEnabled = true;
let autoCollectTimer: number | undefined;
let collectionInProgress = false;
let collectionQueued = false;
const collectedJobIds = new Set<string>();

function firstMatch(selectors: string[]): Element | null {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent && el.textContent.trim().length > 0) {
      return el;
    }
  }
  return null;
}

function text(el: Element | null): string {
  return el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function extractTitle(): string {
  return text(firstMatch([
    '.job-detail-container .job-name',
    '.job-title h1',
    'h1.name',
    '.job-name',
  ]));
}

// BOSS Zhipin pads job descriptions with zero-size/hidden spans (each paired
// with an inline <style> rule) to poison text scraped via plain
// textContent. Walk the tree and skip any node CSS-hides or shrinks to
// near-nothing, so only what a human would actually see is collected.
function isNoiseNode(el: Element): boolean {
  if (el.tagName === 'STYLE' || el.tagName === 'SCRIPT') {
    return true;
  }
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return true;
  }
  const width = parseFloat(style.width);
  const height = parseFloat(style.height);
  if (!isNaN(width) && !isNaN(height) && width <= 1 && height <= 1 && style.overflow === 'hidden') {
    return true;
  }
  return false;
}

function visibleText(el: Element | null): string {
  if (!el) {
    return '';
  }
  let result = '';
  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    if (isNoiseNode(node as Element)) {
      return;
    }
    for (const child of Array.from(node.childNodes)) {
      walk(child);
    }
  }
  walk(el);
  return result.replace(/\s+/g, ' ').trim();
}

function extractCompany(): string {
  // Two-column recommendation page: "<company name> · 招聘者".
  const attrEl = document.querySelector('.job-detail-container .boss-info-attr');
  const attrText = text(attrEl);
  if (attrText) {
    // Strip the trailing "· <recruiter title>" segment (e.g. "· 招聘者",
    // "· 人事经理", "· HRBP") so only the company name remains.
    return attrText.replace(/\s*·[^·]*$/, '').trim();
  }

  // Legacy standalone job_detail page.
  const legacyEl = firstMatch([
    '.company-name',
    'a.company-name',
    '.job-detail-header .company-name',
  ]);
  return text(legacyEl);
}

function extractWorkAddress(): string | null {
  // Two-column recommendation page: full building-level address text. Uses
  // visibleText (not text) because some job cards inject hidden
  // dash-joined address-breadcrumb noise into this element, same anti-
  // scrape pattern as the description field.
  const recommendEl = document.querySelector('.job-detail-container .job-address-desc');
  const recommendText = visibleText(recommendEl);
  if (recommendText) {
    return recommendText;
  }

  // Legacy district-level address block on the standalone job_detail page.
  const districtEl = firstMatch([
    '.job-address .location-address',
    '.location-address',
    '.job-detail-address',
    '.job-address-text',
  ]);
  const districtText = text(districtEl);
  if (districtText) {
    return districtText;
  }

  // City-level fallback, e.g. the city tag shown next to the job title.
  const cityEl = firstMatch(['.job-area', '.job-city', '.name .job-area']);
  const cityText = text(cityEl);
  return cityText || null;
}

function extractSourceUrl(): string | null {
  // Two-column recommendation page: the detail panel's permalink to the
  // standalone job_detail page for the job currently shown on the right.
  // The page URL itself (`/web/geek/jobs`) never changes as the user clicks
  // different cards, so it cannot be used for per-job dedup/back-navigation.
  const permalink = document.querySelector('.job-detail-container a.more-job-btn');
  const href = permalink?.getAttribute('href');
  if (href) {
    return new URL(href, location.origin).toString();
  }

  // Legacy standalone job_detail page: the page URL itself is the job.
  if (/\/job_detail\//.test(location.pathname)) {
    return location.href;
  }

  return null;
}

type JobIdentity = {
  jobId: string | null;
  sourceUrl: string | null;
  source: string | null;
};

const JOB_ID_ATTRIBUTES = [
  'data-job-id',
  'data-jobid',
  'job-id',
];
const JOB_SECURITY_ID_ATTRIBUTES = [
  'data-security-id',
  'data-securityid',
  'security-id',
];

function extractJobIdFromUrl(sourceUrl: string | null): string | null {
  if (!sourceUrl) {
    return null;
  }

  try {
    const url = new URL(sourceUrl, location.origin);
    const pathMatch = url.pathname.match(/\/job_detail\/([^/?#.]+)\.html/);
    if (pathMatch?.[1]) {
      return pathMatch[1];
    }

    for (const key of ['jobId', 'jobid', 'securityId']) {
      const value = url.searchParams.get(key);
      if (value) {
        return value;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function extractIdentityFromAttributes(
  element: Element,
  source: string,
  includeSecurityId = false,
): JobIdentity | null {
  const attributes = includeSecurityId
    ? [...JOB_ID_ATTRIBUTES, ...JOB_SECURITY_ID_ATTRIBUTES]
    : JOB_ID_ATTRIBUTES;
  for (const attribute of attributes) {
    const value = element.getAttribute(attribute)?.trim();
    if (value) {
      return { jobId: value, sourceUrl: null, source: `${source}:${attribute}` };
    }
  }

  return null;
}

function extractIdentityFromLink(link: HTMLAnchorElement, source: string): JobIdentity | null {
  const href = link.getAttribute('href');
  if (!href) {
    return null;
  }

  try {
    const sourceUrl = new URL(href, location.origin).toString();
    const jobId = extractJobIdFromUrl(sourceUrl);
    return jobId ? { jobId, sourceUrl, source: `${source}:href` } : null;
  } catch {
    return null;
  }
}

function extractJobIdentity(sourceUrl: string | null, title: string): JobIdentity {
  const sourceUrlJobId = extractJobIdFromUrl(sourceUrl);
  if (sourceUrlJobId) {
    return { jobId: sourceUrlJobId, sourceUrl, source: 'detail-permalink' };
  }

  const panel = getDetailPanel();
  if (panel) {
    const panelCandidates = [
      panel,
      ...Array.from(panel.querySelectorAll([
        '[data-job-id]',
        '[data-jobid]',
        '[job-id]',
        '.job-detail-info',
        '.job-detail-header',
        '.job-name',
      ].join(','))),
    ];
    for (const candidate of panelCandidates) {
      const identity = extractIdentityFromAttributes(candidate, 'detail-panel');
      if (identity) {
        return { ...identity, sourceUrl: identity.sourceUrl ?? sourceUrl };
      }
    }

    const panelJobLinks = panel.querySelectorAll<HTMLAnchorElement>('a[href*="/job_detail/"]');
    for (const link of panelJobLinks) {
      if (title && text(link).includes(title)) {
        const identity = extractIdentityFromLink(link, 'detail-panel-job-link');
        if (identity) {
          return identity;
        }
      }
    }
  }

  const selectedCardSelectors = [
    '.job-card-wrap.active',
    '.job-card-wrapper.active',
    '.job-card-box.active',
    '.job-card-wrap.selected',
    '.job-card-wrapper.selected',
    '.job-card-box.selected',
    '[aria-selected="true"]',
  ];
  for (const selector of selectedCardSelectors) {
    const selectedCard = document.querySelector(selector);
    if (!selectedCard) {
      continue;
    }
    const identity = extractIdentityFromAttributes(selectedCard, 'selected-job-card', true)
      ?? extractIdentityFromAttributes(
        selectedCard.querySelector('[data-job-id], [data-jobid], [job-id]') ?? selectedCard,
        'selected-job-card-descendant',
      )
      ?? (() => {
        const link = selectedCard.querySelector<HTMLAnchorElement>('a[href*="/job_detail/"]');
        return link ? extractIdentityFromLink(link, 'selected-job-card-link') : null;
      })();
    if (identity) {
      return { ...identity, sourceUrl: identity.sourceUrl ?? sourceUrl };
    }
  }

  if (title) {
    const jobCards = document.querySelectorAll([
      '.job-card-wrap',
      '.job-card-wrapper',
      '.job-card-box',
    ].join(','));
    for (const card of jobCards) {
      if (!text(card).includes(title)) {
        continue;
      }
      const identity = extractIdentityFromAttributes(card, 'title-matched-job-card', true)
        ?? (() => {
          const link = card.querySelector<HTMLAnchorElement>('a[href*="/job_detail/"]');
          return link ? extractIdentityFromLink(link, 'title-matched-job-card-link') : null;
        })();
      if (identity) {
        return { ...identity, sourceUrl: identity.sourceUrl ?? sourceUrl };
      }
    }

    const jobLinks = document.querySelectorAll<HTMLAnchorElement>('a[href*="/job_detail/"]');
    for (const link of jobLinks) {
      if (text(link).includes(title)) {
        const identity = extractIdentityFromLink(link, 'title-matched-job-link');
        if (identity) {
          return { ...identity, sourceUrl: identity.sourceUrl ?? sourceUrl };
        }
      }
    }
  }

  return { jobId: null, sourceUrl, source: null };
}

function extractJd(): JdPayload {
  const descriptionEl = firstMatch([
    '.job-detail-container p.desc',
    '.job-detail-body',
    '.job-sec-text',
    '.job-sec .text',
    '.job-detail-section .text',
  ]);

  return {
    title: extractTitle(),
    company: extractCompany(),
    description: visibleText(descriptionEl),
    workAddress: extractWorkAddress(),
    sourceUrl: extractSourceUrl(),
  };
}

// Guards against reading the right-hand detail panel mid-render right after
// the user clicks a different card in the left-hand list: polls the title
// text until it reads the same value twice in a row (i.e. stopped changing)
// before extracting, instead of trusting whatever is on screen at the exact
// instant REQUEST_EXTRACT arrives. Always resolves, even if content never
// stabilizes, so a slow/odd render can't hang extraction forever.
function waitForStableDetail(): Promise<void> {
  const POLL_INTERVAL_MS = 80;
  const MAX_WAIT_MS = 1500;

  return new Promise((resolve) => {
    const start = Date.now();
    let previous = text(document.querySelector(DETAIL_TITLE_SELECTOR));

    const tick = () => {
      const current = text(document.querySelector(DETAIL_TITLE_SELECTOR));
      if (current === previous || Date.now() - start >= MAX_WAIT_MS) {
        resolve();
        return;
      }
      previous = current;
      setTimeout(tick, POLL_INTERVAL_MS);
    };

    setTimeout(tick, POLL_INTERVAL_MS);
  });
}

function getDetailPanel(): Element | null {
  return document.querySelector(DETAIL_PANEL_SELECTOR);
}

function markCurrentJobCollected() {
  const panel = getDetailPanel();
  if (!panel || panel.querySelector(`[${COLLECTED_MARKER_ATTRIBUTE}]`)) {
    return;
  }

  const marker = document.createElement('span');
  marker.setAttribute(COLLECTED_MARKER_ATTRIBUTE, 'true');
  marker.textContent = '已采集 ✓';
  marker.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'margin-left:8px',
    'padding:2px 7px',
    'border-radius:10px',
    'background:#e8f8ef',
    'color:#06ae56',
    'font-size:12px',
    'font-weight:600',
    'line-height:18px',
  ].join(';');

  const title = panel.querySelector('.job-name');
  if (title) {
    title.insertAdjacentElement('afterend', marker);
  } else {
    panel.prepend(marker);
  }
}

function removeCollectedMarker() {
  document.querySelector(`[${COLLECTED_MARKER_ATTRIBUTE}]`)?.remove();
}

async function rememberCollectedJob(jobId: string) {
  const stored = await chrome.storage.local.get(COLLECTED_JOB_IDS_KEY);
  const storedIds = stored[COLLECTED_JOB_IDS_KEY];
  if (Array.isArray(storedIds)) {
    for (const id of storedIds) {
      if (typeof id === 'string') {
        collectedJobIds.add(id);
      }
    }
  }
  collectedJobIds.add(jobId);
  const ids = Array.from(collectedJobIds);
  await chrome.storage.local.set({
    [COLLECTED_JOB_IDS_KEY]: ids,
    [COLLECTED_JOB_COUNT_KEY]: ids.length,
  });
}

async function recordCollectionResult(
  result: BackgroundResult,
  details: { title: string; jobId?: string; jobIdSource?: string },
): Promise<BackgroundResult> {
  const record: CollectionRecord = {
    attemptedAt: new Date().toISOString(),
    title: details.title,
    result: result.ok ? 'success' : 'failure',
    ...(!result.ok ? { error: result.error } : {}),
    ...(details.jobId ? { jobId: details.jobId } : {}),
    ...(details.jobIdSource ? { jobIdSource: details.jobIdSource } : {}),
  };
  await appendCollectionRecord(record);
  return result;
}

async function collectCurrentJob(): Promise<BackgroundResult> {
  let title = extractTitle();
  let jobId: string | undefined;
  let jobIdSource: string | undefined;

  if (collectionInProgress) {
    collectionQueued = true;
    return recordCollectionResult(
      { ok: false, error: '当前岗位正在采集中' },
      { title },
    );
  }

  collectionInProgress = true;
  collectionQueued = false;
  try {
    await waitForStableDetail();
    title = extractTitle();
    if (!autoCollectEnabled) {
      return recordCollectionResult(
        { ok: false, error: '自动采集已关闭' },
        { title },
      );
    }
    const payload = extractJd();
    title = payload.title;

    if (!payload.title && !payload.company && !payload.description) {
      return recordCollectionResult(
        { ok: false, error: '未能在页面中找到岗位信息，选择器可能已失效' },
        { title },
      );
    }

    const identity = extractJobIdentity(payload.sourceUrl, payload.title);
    jobId = identity.jobId ?? undefined;
    jobIdSource = identity.source ?? undefined;
    payload.sourceUrl = identity.sourceUrl;
    if (!jobId) {
      return recordCollectionResult(
        { ok: false, error: '未能识别当前职位 id' },
        { title },
      );
    }

    if (collectedJobIds.has(jobId)) {
      markCurrentJobCollected();
      return recordCollectionResult(
        { ok: true },
        { title, jobId, jobIdSource },
      );
    }

    const result = (await chrome.runtime.sendMessage({
      type: 'JD_EXTRACTED',
      payload,
    })) as BackgroundResult;

    if (result.ok) {
      await rememberCollectedJob(jobId);
      markCurrentJobCollected();
    }

    return recordCollectionResult(result, { title, jobId, jobIdSource });
  } catch (err) {
    return recordCollectionResult(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { title, jobId, jobIdSource },
    );
  } finally {
    collectionInProgress = false;
    if (collectionQueued && autoCollectEnabled) {
      scheduleAutoCollect();
    }
  }
}

function isCollectedMarkerNode(node: Node): boolean {
  return node instanceof Element
    && (node.hasAttribute(COLLECTED_MARKER_ATTRIBUTE)
      || Boolean(node.querySelector(`[${COLLECTED_MARKER_ATTRIBUTE}]`)));
}

function isOnlyCollectedMarkerMutation(records: MutationRecord[]): boolean {
  return records.length > 0 && records.every((record) => {
    if (record.type !== 'childList') {
      return false;
    }
    const changedNodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
    return changedNodes.length > 0 && changedNodes.every(isCollectedMarkerNode);
  });
}

function scheduleAutoCollect() {
  removeCollectedMarker();
  if (!autoCollectEnabled) {
    return;
  }

  if (autoCollectTimer !== undefined) {
    window.clearTimeout(autoCollectTimer);
  }
  autoCollectTimer = window.setTimeout(() => {
    autoCollectTimer = undefined;
    void collectCurrentJob();
  }, AUTO_COLLECT_DEBOUNCE_MS);
}

function observeDetailPanel() {
  let observedPanel: Element | null = null;
  let detailObserver: MutationObserver | null = null;

  const attachToCurrentPanel = () => {
    const panel = getDetailPanel();
    if (!panel || panel === observedPanel) {
      return;
    }

    detailObserver?.disconnect();
    observedPanel = panel;
    detailObserver = new MutationObserver((records) => {
      if (!isOnlyCollectedMarkerMutation(records)) {
        scheduleAutoCollect();
      }
    });
    detailObserver.observe(panel, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['href'],
    });
    scheduleAutoCollect();
  };

  const pageObserver = new MutationObserver(attachToCurrentPanel);
  pageObserver.observe(document.documentElement, { childList: true, subtree: true });
  attachToCurrentPanel();
}

async function initializeAutoCollection() {
  const stored = await chrome.storage.local.get([
    AUTO_COLLECT_ENABLED_KEY,
    COLLECTED_JOB_IDS_KEY,
  ]);
  autoCollectEnabled = stored[AUTO_COLLECT_ENABLED_KEY] !== false;

  const ids = stored[COLLECTED_JOB_IDS_KEY];
  if (Array.isArray(ids)) {
    for (const id of ids) {
      if (typeof id === 'string') {
        collectedJobIds.add(id);
      }
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }

    if (changes[COLLECTED_JOB_IDS_KEY] && Array.isArray(changes[COLLECTED_JOB_IDS_KEY].newValue)) {
      for (const id of changes[COLLECTED_JOB_IDS_KEY].newValue) {
        if (typeof id === 'string') {
          collectedJobIds.add(id);
        }
      }
    }

    if (changes[AUTO_COLLECT_ENABLED_KEY]) {
      autoCollectEnabled = changes[AUTO_COLLECT_ENABLED_KEY].newValue !== false;
      if (autoCollectEnabled) {
        scheduleAutoCollect();
      } else if (autoCollectTimer !== undefined) {
        window.clearTimeout(autoCollectTimer);
        autoCollectTimer = undefined;
      }
    }
  });

  observeDetailPanel();
}

export default defineContentScript({
  matches: [
    'https://www.zhipin.com/web/geek/jobs*',
    'https://www.zhipin.com/web/geek/job-recommend*',
    'https://www.zhipin.com/job_detail/*',
  ],
  main() {
    void initializeAutoCollection();
  },
});
