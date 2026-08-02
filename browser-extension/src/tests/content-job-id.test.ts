import { describe, expect, it, vi } from 'vitest';

function appBuildJobId(title: string, company: string, city: string): string {
  const slug = `${company}-${title}-${city}`
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `job-${slug || 'item'}`;
}

describe('computeAppJobId', () => {
  it.each([
    ['Senior Frontend Engineer', 'Acme, Inc.'],
    ['高级前端工程师', '上海未来科技有限公司'],
    ['AI/ML 研发工程师', '北京-星河 AI'],
  ])('mirrors the application job id for %s at %s', async (title, company) => {
    vi.stubGlobal('defineContentScript', vi.fn());
    vi.stubGlobal('chrome', {
      storage: { local: { get: vi.fn(), set: vi.fn() }, onChanged: { addListener: vi.fn() } },
    });
    const { computeAppJobId } = await import('../../entrypoints/content');
    expect(computeAppJobId(title, company)).toBe(appBuildJobId(title, company, ''));
  });
});
