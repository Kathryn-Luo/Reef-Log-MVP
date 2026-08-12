import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ProfileAvatar from '../../../app/components/ProfileAvatar.vue'

describe('ProfileAvatar', () => {
  it('Google 頭像顯示圖片與來源標記', async () => {
    const avatar = await mountSuspended(ProfileAvatar, {
      props: {
        avatarUrl: 'https://example.test/google.png',
        avatarSource: 'google',
        displayName: '陳彥廷',
      },
    })

    expect(avatar.get('[data-testid="profile-avatar-image"]').attributes('src'))
      .toBe('https://example.test/google.png')
    expect(avatar.find('[data-testid="profile-avatar-google"]').exists()).toBe(true)
  })

  it('自訂頭像顯示圖片，但不冒充 Google 來源', async () => {
    const avatar = await mountSuspended(ProfileAvatar, {
      props: {
        avatarUrl: 'https://example.test/custom.png',
        avatarSource: 'custom',
        displayName: '林小海',
      },
    })

    expect(avatar.get('[data-testid="profile-avatar-image"]').attributes('src'))
      .toBe('https://example.test/custom.png')
    expect(avatar.find('[data-testid="profile-avatar-google"]').exists()).toBe(false)
  })

  it('沒有照片時顯示名稱首字', async () => {
    const avatar = await mountSuspended(ProfileAvatar, {
      props: { avatarUrl: null, avatarSource: 'none', displayName: '訪客' },
    })

    expect(avatar.get('[data-testid="profile-avatar-initial"]').text()).toBe('訪')
    expect(avatar.find('img').exists()).toBe(false)
  })

  it('沒有照片也沒有名稱時顯示 circle-user icon', async () => {
    const avatar = await mountSuspended(ProfileAvatar, {
      props: { avatarUrl: null, avatarSource: 'none', displayName: null },
    })

    expect(avatar.find('[data-testid="profile-avatar-icon"]').exists()).toBe(true)
  })

  it('圖片載入失敗時移除破圖，退回名稱首字', async () => {
    const avatar = await mountSuspended(ProfileAvatar, {
      props: {
        avatarUrl: 'https://example.test/broken.png',
        avatarSource: 'google',
        displayName: '訪客',
      },
    })

    await avatar.get('[data-testid="profile-avatar-image"]').trigger('error')

    expect(avatar.find('img').exists()).toBe(false)
    expect(avatar.get('[data-testid="profile-avatar-initial"]').text()).toBe('訪')
    expect(avatar.find('[data-testid="profile-avatar-google"]').exists()).toBe(false)
  })
})
