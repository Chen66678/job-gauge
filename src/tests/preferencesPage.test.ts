// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PreferencesPage from '../PreferencesPage'
import type { CoreState } from '../domain/coreState'
import type { WorkflowApi } from '../workflowApi'

const preferenceState = {
  preferences: {
    ruleSet: {
      targetRoles: ['前端工程师'],
      targetCities: [],
      minSalaryK: 0,
      excludedKeywords: ['外包'],
      preferCompanyTags: [],
      confidence: 1.0,
    },
    hardVeto: { rules: [] },
  },
} as unknown as CoreState

function renderSavedPreferences() {
  const api = {
    getState: vi.fn(async () => preferenceState),
    setPreferencesFromText: vi.fn(async () => preferenceState.preferences),
  } as unknown as WorkflowApi
  window.coreApi = api as unknown as typeof window.coreApi
  render(createElement(PreferencesPage))
  return api
}

async function savePreferences() {
  fireEvent.change(screen.getByPlaceholderText(/想做前端/), { target: { value: '前端工程师，不要外包' } })
  fireEvent.click(screen.getByRole('button', { name: '保存偏好' }))
  await screen.findByText('✓ 偏好已保存，硬否决规则已更新')
}

afterEach(cleanup)

describe('PreferencesPage editable chips', () => {
  it('removes a single chip from the local display', async () => {
    renderSavedPreferences()
    await savePreferences()

    fireEvent.click(screen.getByRole('button', { name: '删除：前端工程师' }))

    expect(screen.queryByText('前端工程师')).toBeNull()
  })

  it('moves a chip to the next category locally', async () => {
    renderSavedPreferences()
    await savePreferences()

    fireEvent.click(screen.getByRole('button', { name: '切换类别：前端工程师' }))

    await waitFor(() => expect(screen.getByText('🏙 目标城市')).toBeTruthy())
    expect(screen.getByText('前端工程师').closest('.pref-chip')?.className).toContain('city')
  })

  it('does not render sections for empty semantic arrays', async () => {
    renderSavedPreferences()
    await savePreferences()

    expect(screen.queryByText('🏙 目标城市')).toBeNull()
    expect(screen.queryByText('💰 最低薪资')).toBeNull()
  })

  it('does not let a delayed mount-time state refresh revive a deleted chip', async () => {
    // IPC round trips (real Electron bridge) always deserialize a fresh object,
    // so the mock must return a new object each call — reusing one reference
    // hides the bug because React's effect-dependency comparison sees "no change".
    const freshState = (): CoreState => JSON.parse(JSON.stringify(preferenceState))
    let resolveMountGetState: ((state: CoreState) => void) | undefined
    let mountGetStateCalled = false
    const api = {
      getState: vi.fn(() => {
        if (!mountGetStateCalled) {
          mountGetStateCalled = true
          return new Promise<CoreState>(resolve => { resolveMountGetState = resolve })
        }
        return Promise.resolve(freshState())
      }),
      setPreferencesFromText: vi.fn(async () => freshState().preferences),
    } as unknown as WorkflowApi
    window.coreApi = api as unknown as typeof window.coreApi

    render(createElement(PreferencesPage))
    // Mount-time getState() is still pending here (simulates a slow IPC round trip).
    await savePreferences()

    fireEvent.click(screen.getByRole('button', { name: '删除：前端工程师' }))
    expect(screen.queryByText('前端工程师')).toBeNull()

    // The stale mount-time refresh now resolves, after the delete already happened.
    resolveMountGetState?.(freshState())

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.queryByText('前端工程师')).toBeNull()
  })
})
