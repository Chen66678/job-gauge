import { describe, expect, it } from 'vitest'
import { displayFactCategory, displayFactLabel } from '../factPresentation'

describe('fact presentation labels', () => {
  it('localizes known internal category names without changing unknown values', () => {
    expect(displayFactCategory('job_search')).toBe('求职意向')
    expect(displayFactCategory('技能')).toBe('技能')
  })

  it('localizes known labels and preserves the meaningful suffix', () => {
    expect(displayFactLabel('professional skills')).toBe('专业技能')
    expect(displayFactLabel('project: Agent Team Runtime')).toBe('项目：Agent Team Runtime')
    expect(displayFactLabel('Python')).toBe('Python')
  })
})
