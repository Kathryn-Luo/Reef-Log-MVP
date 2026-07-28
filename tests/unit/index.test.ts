import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import IndexPage from '../../app/pages/index.vue'

describe('index page', () => {
  it('renders the ReefLog heading', async () => {
    const component = await mountSuspended(IndexPage)
    expect(component.text()).toContain('ReefLog')
  })
})
