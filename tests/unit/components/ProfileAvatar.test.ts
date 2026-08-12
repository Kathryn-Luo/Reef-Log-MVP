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
      props: { avatarUrl: null, avatarSource: 'none', displayName: '林小海', providers: ['GOOGLE'] },
    })

    expect(avatar.get('[data-testid="profile-avatar-initial"]').text()).toBe('林')
    expect(avatar.find('img').exists()).toBe(false)
  })

  it('沒有照片也沒有名稱時顯示 circle-user icon', async () => {
    const avatar = await mountSuspended(ProfileAvatar, {
      props: { avatarUrl: null, avatarSource: 'none', displayName: null, providers: ['GOOGLE'] },
    })

    expect(avatar.find('[data-testid="profile-avatar-icon"]').exists()).toBe(true)
  })

  // 純訪客的「訪客」是系統給每一位訪客的同一個固定字串，那個「訪」認不出任何人
  it('純訪客不顯示首字，直接用預設 icon', async () => {
    const avatar = await mountSuspended(ProfileAvatar, {
      props: { avatarUrl: null, avatarSource: 'none', displayName: '訪客', providers: ['GUEST'] },
    })

    expect(avatar.find('[data-testid="profile-avatar-initial"]').exists()).toBe(false)
    expect(avatar.find('[data-testid="profile-avatar-icon"]').exists()).toBe(true)
  })

  // 判斷看的是 provider，不是名字的內容——使用者可以把自己的名字改成「訪客」
  it('Google 使用者把名字改成「訪客」時仍顯示首字', async () => {
    const avatar = await mountSuspended(ProfileAvatar, {
      props: { avatarUrl: null, avatarSource: 'none', displayName: '訪客', providers: ['GOOGLE'] },
    })

    expect(avatar.get('[data-testid="profile-avatar-initial"]').text()).toBe('訪')
  })

  it('同時掛著 GUEST 與 GOOGLE 時顯示首字', async () => {
    const avatar = await mountSuspended(ProfileAvatar, {
      props: { avatarUrl: null, avatarSource: 'none', displayName: '林小海', providers: ['GUEST', 'GOOGLE'] },
    })

    expect(avatar.get('[data-testid="profile-avatar-initial"]').text()).toBe('林')
  })

  it('訪客上傳過的自訂頭像仍然顯示，不受首字規則影響', async () => {
    const avatar = await mountSuspended(ProfileAvatar, {
      props: {
        avatarUrl: 'https://example.test/custom.png',
        avatarSource: 'custom',
        displayName: '訪客',
        providers: ['GUEST'],
      },
    })

    expect(avatar.get('[data-testid="profile-avatar-image"]').attributes('src'))
      .toBe('https://example.test/custom.png')
  })

  it('圖片載入失敗時移除破圖，退回名稱首字', async () => {
    const avatar = await mountSuspended(ProfileAvatar, {
      props: {
        avatarUrl: 'https://example.test/broken.png',
        avatarSource: 'google',
        displayName: '林小海',
        providers: ['GOOGLE'],
      },
    })

    await avatar.get('[data-testid="profile-avatar-image"]').trigger('error')

    expect(avatar.find('img').exists()).toBe(false)
    expect(avatar.get('[data-testid="profile-avatar-initial"]').text()).toBe('林')
    expect(avatar.find('[data-testid="profile-avatar-google"]').exists()).toBe(false)
  })

  it('訪客的圖片載入失敗時退回預設 icon，不是首字', async () => {
    const avatar = await mountSuspended(ProfileAvatar, {
      props: {
        avatarUrl: 'https://example.test/broken.png',
        avatarSource: 'custom',
        displayName: '訪客',
        providers: ['GUEST'],
      },
    })

    await avatar.get('[data-testid="profile-avatar-image"]').trigger('error')

    expect(avatar.find('[data-testid="profile-avatar-initial"]').exists()).toBe(false)
    expect(avatar.find('[data-testid="profile-avatar-icon"]').exists()).toBe(true)
  })
})
