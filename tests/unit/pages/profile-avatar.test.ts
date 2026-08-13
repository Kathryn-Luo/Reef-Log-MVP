import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import {
  AVATAR_FIELD_NAME,
  AVATAR_TOO_LARGE_MESSAGE,
  AVATAR_UNSUPPORTED_MESSAGE,
} from '#shared/utils/avatarUpload'
import ProfilePage from '../../../app/pages/profile.vue'
import { AVATAR_OUTPUT_FILENAME, AVATAR_OUTPUT_TYPE } from '../../../app/utils/avatarImage'
import { signedInUserSession } from '../support/session'

// 自訂頭像的上傳與移除（issue #168）。
//
// 縮圖本身的規格（512 px、WebP、只縮不放、EXIF 方向）由 tests/unit/app/resize-avatar.test.ts
// 守著；這一支守的是畫面這一側：送出的是縮好的那一份、上傳中不能再送一次、兩種 400
// 各說各的話、沒有自訂頭像時不給「移除」，以及每次處理完 file input 都被清空。
//
// happy-dom 沒有能用的 `createImageBitmap` 與 canvas，所以**預設**就走「縮圖失敗、
// 改送原檔」那條路——那正好是 Story 裡的退場路徑。要驗成功路徑的那一條自己架替身。

mockNuxtImport('useUserSession', () => () => signedInUserSession())

interface MockNodeEvent {
  node: { req: { body?: unknown } }
}

const GOOGLE_AVATAR = 'https://example.test/google.png'
const CUSTOM_AVATAR = 'https://blob.example.test/avatars/u1/old.webp'
const UPLOADED_AVATAR = 'https://blob.example.test/avatars/u1/new.webp'

const GOOGLE_PROFILE = {
  displayName: '林小海',
  email: 'seahayashi@gmail.com',
  providers: ['GOOGLE'],
  createdAt: '2024-08-09T04:00:00.000Z',
  avatarUrl: GOOGLE_AVATAR,
  avatarSource: 'google',
} as const

interface UploadedFile {
  field: string
  name: string
  type: string
  size: number
}

const state = {
  profile: { ...GOOGLE_PROFILE } as Record<string, unknown>,
  /** 上傳後 server 回的那一份。null＝沿用預設（換成 UPLOADED_AVATAR 的自訂頭像） */
  postResult: null as Record<string, unknown> | null,
  postCalls: 0,
  uploaded: [] as UploadedFile[],
  postFailure: null as { statusCode: number, message?: string } | null,
  /** 讓 POST 停在半路，好觀察「上傳中」那一態 */
  postPending: false,
  resolvePost: null as (() => void) | null,
  deleteCalls: 0,
  deleteResult: null as Record<string, unknown> | null,
  deleteFailure: null as { statusCode: number, message?: string } | null,
}

registerEndpoint('/api/profile', {
  method: 'GET',
  handler: () => state.profile,
})

registerEndpoint('/api/profile/avatar', {
  method: 'POST',
  handler: async (event) => {
    state.postCalls += 1

    const body = (event as unknown as MockNodeEvent).node.req.body

    if (body instanceof FormData) {
      for (const [field, value] of body.entries()) {
        if (value instanceof File) {
          state.uploaded.push({ field, name: value.name, type: value.type, size: value.size })
        }
      }
    }

    if (state.postPending) {
      await new Promise<void>((resolve) => {
        state.resolvePost = resolve
      })
    }

    if (state.postFailure) {
      throw createError({
        statusCode: state.postFailure.statusCode,
        statusMessage: 'Avatar upload rejected',
        data: state.postFailure.message ? { message: state.postFailure.message } : undefined,
      })
    }

    state.profile = state.postResult
      ?? { ...state.profile, avatarUrl: UPLOADED_AVATAR, avatarSource: 'custom' }

    return state.profile
  },
})

registerEndpoint('/api/profile/avatar', {
  method: 'DELETE',
  handler: () => {
    state.deleteCalls += 1

    if (state.deleteFailure) {
      throw createError({
        statusCode: state.deleteFailure.statusCode,
        statusMessage: 'Avatar removal failed',
        data: state.deleteFailure.message ? { message: state.deleteFailure.message } : undefined,
      })
    }

    state.profile = state.deleteResult
      ?? { ...state.profile, avatarUrl: GOOGLE_AVATAR, avatarSource: 'google' }

    return state.profile
  },
})

enableAutoUnmount(afterEach)

beforeEach(() => {
  clearNuxtData('profile')
  clearNuxtState()
  state.profile = { ...GOOGLE_PROFILE }
  state.postResult = null
  state.postCalls = 0
  state.uploaded = []
  state.postFailure = null
  state.postPending = false
  state.resolvePost = null
  state.deleteCalls = 0
  state.deleteResult = null
  state.deleteFailure = null
})

afterEach(() => {
  vi.unstubAllGlobals()
})

type Page = VueWrapper<InstanceType<typeof ProfilePage>>

/**
 * `attached`＝把畫面真的掛進 document。
 *
 * 焦點只存在於「文件裡的元素」上：沒掛進去的話 `element.focus()` 一律無效，
 * `document.activeElement` 永遠是 body，驗焦點的測試會恆綠。只有需要驗焦點的那幾條
 * 才開，其餘維持原本的離線掛載（比較快，也不必自己收拾 document）。
 */
async function open(profile?: Record<string, unknown>, attached = false): Promise<Page> {
  if (profile) {
    state.profile = profile
  }

  const page = await mountSuspended(ProfilePage, {
    route: '/profile',
    ...(attached ? { attachTo: document.body } : {}),
  }) as unknown as Page
  await flushPromises()
  return page
}

const CUSTOM_AVATAR_PROFILE = { ...GOOGLE_PROFILE, avatarUrl: CUSTOM_AVATAR, avatarSource: 'custom' }

/** 相機拍的原檔尺寸。縮圖存在的理由，也是「縮不動就走不通」的那個大小 */
const CAMERA_PHOTO_BYTES = 6 * 1024 * 1024

/**
 * 預設**在上限之內**（1 MB）。
 *
 * happy-dom 沒有能用的 createImageBitmap 與 canvas，所以這一支測試檔裡的每一次選檔
 * 都走「縮不動」那條路。而縮不動又超過上限時畫面會直接擋下、根本不送出（見下方
 * 那兩條 test）——預設若是 6 MB，所有「送出之後怎麼樣」的測試都會停在送出之前。
 * 要那個大小的自己傳 `CAMERA_PHOTO_BYTES`。
 */
function photo(name = 'IMG_4823.JPG', type = 'image/jpeg', bytes = 1024 * 1024): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

/**
 * 選一個檔案。
 *
 * `files` 在真實瀏覽器裡由使用者的選取填入，測試只能自己掛上去；回傳的
 * `valueResets` 記錄「處理過程中 input 的值被設成什麼」——同一張圖選第二次還能不能
 * 觸發，靠的正是這一次清空（見下方那條 test）。
 */
async function chooseFile(page: Page, file: File) {
  const input = page.get('[data-testid="profile-avatar-input"]')
  const element = input.element as HTMLInputElement
  const valueResets: string[] = []

  Object.defineProperty(element, 'files', { value: [file], configurable: true, writable: true })
  Object.defineProperty(element, 'value', {
    configurable: true,
    get: () => '',
    set: (next: string) => {
      valueResets.push(next)
    },
  })

  await input.trigger('change')
  await settle()

  return { valueResets }
}

/**
 * 等這一次上傳 / 移除真的落地。
 *
 * 一次 `flushPromises()` 不夠：處理鏈是「縮圖 → FormData → $fetch」，而被攔截的
 * $fetch 自己還要再跨一個 macrotask 才把回應交回來。少等那一拍的話，斷言看到的是
 * 請求已經送出、畫面卻還沒更新的中間狀態——那不是任何使用者看得到的畫面。
 */
async function settle() {
  await flushPromises()
  await flushPromises()
  await nextTick()
}

/**
 * 讓 `resizeAvatar` 真的縮得出東西：happy-dom 三樣都缺，全部換成替身。
 *
 * `encodedBytes` 是編碼器吐出來的大小。預設 48 KB（長邊 512 的 WebP 的實際量級），
 * 要驗「縮完仍然過大」那一格的自己調大。
 */
function stubImagePipeline(encodedBytes = 48 * 1024) {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4032, height: 3024, close: () => {} })))

  const originalGetContext = HTMLCanvasElement.prototype.getContext
  const originalToBlob = HTMLCanvasElement.prototype.toBlob

  HTMLCanvasElement.prototype.getContext = (() => ({ drawImage: () => {} })) as never
  HTMLCanvasElement.prototype.toBlob = function (callback: BlobCallback, type?: string) {
    callback(new Blob([new Uint8Array(encodedBytes)], { type: type ?? AVATAR_OUTPUT_TYPE }))
  }

  return () => {
    HTMLCanvasElement.prototype.getContext = originalGetContext
    HTMLCanvasElement.prototype.toBlob = originalToBlob
  }
}

describe('/profile 更換頭像', () => {
  // Given 我在手機上的 /profile
  // When  我點下「更換頭像」
  // Then  出現作業系統原生的選單，「拍照」與「從相簿選」兩條路都在；畫面不會直接跳進相機
  //
  // 「原生選單長什麼樣」在 jsdom 裡看不見，看得見的是決定它的那兩個屬性：
  //   - accept 列三種具體 MIME（寫 image/* 的話 iOS 會原封不動交出 HEIC）
  //   - 沒有 capture（加上去會直接叫起相機，並拿掉「從相簿選」）
  it('檔案輸入只收 JPEG / PNG / WebP，且沒有 capture', async () => {
    const page = await open()
    const input = page.get('[data-testid="profile-avatar-input"]')

    expect(input.attributes('type')).toBe('file')
    expect(input.attributes('accept')).toBe('image/jpeg,image/png,image/webp')
    expect(input.attributes('accept')).not.toContain('image/*')
    expect(input.attributes('capture')).toBeUndefined()
    expect(input.attributes('multiple')).toBeUndefined()
  })

  it('按下「更換頭像」會開啟檔案選擇', async () => {
    const page = await open()
    const input = page.get('[data-testid="profile-avatar-input"]').element as HTMLInputElement
    const openPicker = vi.spyOn(input, 'click')

    await page.get('[data-testid="profile-avatar-upload"]').trigger('click')

    expect(openPicker).toHaveBeenCalledTimes(1)
  })

  it('動作按鈕有看得懂的名稱', async () => {
    const page = await open(CUSTOM_AVATAR_PROFILE)

    expect(page.get('[data-testid="profile-avatar-upload"]').text()).toContain('更換頭像')
    expect(page.get('[data-testid="profile-avatar-remove"]').text()).toContain('移除頭像')
    expect(page.get('[data-testid="profile-avatar-input"]').attributes('aria-label')).toBeTruthy()
  })

  it('限制文案只寫支援的格式，不出現 2 MB', async () => {
    const page = await open()
    const hint = page.get('[data-testid="profile-avatar-hint"]')

    expect(hint.text()).toBe('支援 JPEG / PNG / WebP')
    expect(page.get('[data-testid="profile-account"]').text()).not.toContain('MB')
  })

  // Given 我從相簿選了一張 6 MB、長邊 4032 px 的手機照片
  // When  前端處理完並送出
  // Then  實際送出的是長邊 512 px 的 WebP、體積遠小於 2 MB，上傳成功
  it('送出的是縮好的 WebP，不是 6 MB 的原檔', async () => {
    const restore = stubImagePipeline()

    try {
      const page = await open()
      await chooseFile(page, photo('IMG_4823.JPG', 'image/jpeg', CAMERA_PHOTO_BYTES))

      expect(state.uploaded).toEqual([{
        field: AVATAR_FIELD_NAME,
        name: AVATAR_OUTPUT_FILENAME,
        type: AVATAR_OUTPUT_TYPE,
        size: 48 * 1024,
      }])
    }
    finally {
      restore()
    }
  })

  // Then  Profile 頁立即顯示新頭像 / 顯示的是 API 回傳的新 URL，不是被瀏覽器快取的舊圖
  it('上傳成功後畫面換成 API 回傳的新 URL', async () => {
    const page = await open(CUSTOM_AVATAR_PROFILE)

    expect(page.get('[data-testid="profile-avatar-image"]').attributes('src')).toBe(CUSTOM_AVATAR)

    await chooseFile(page, photo())

    expect(state.postCalls).toBe(1)

    const src = page.get('[data-testid="profile-avatar-image"]').attributes('src')
    expect(src).toBe(UPLOADED_AVATAR)
    // 每次上傳都是一個新的 immutable Blob 路徑，所以不必、也不該自己加 cache-busting 參數
    expect(src).not.toContain('?')
  })

  // Given 前端縮圖失敗（瀏覽器不支援 createImageBitmap／canvas，或檔案無法解碼）
  // When  我送出
  // Then  前端改送原檔而不是直接報錯
  // 原檔本來就在上限內時，縮不動不構成問題：送出去 server 收得下。前端不必自己
  // 先擋一手——它不是安全邊界，多擋一層只會多一個與 server 分岔的機會。
  it('縮圖失敗但原檔在上限內時，照樣送出原檔，不在前端就報錯', async () => {
    const page = await open()

    await chooseFile(page, photo('IMG_4823.JPG', 'image/jpeg', 1024 * 1024))

    expect(state.uploaded).toEqual([{
      field: AVATAR_FIELD_NAME,
      name: 'IMG_4823.JPG',
      type: 'image/jpeg',
      size: 1024 * 1024,
    }])
    expect(page.find('[data-testid="profile-avatar-error"]').exists()).toBe(false)
  })

  // Given 這台裝置縮不動照片（舊瀏覽器），而我選的是相機拍的 6 MB 原檔
  // When  我送出
  // Then  畫面直接說明是裝置縮不動，而不是把它上傳完再由 server 回「圖片請控制在 2 MB 以內」
  //
  // 那句 server 的訊息在這個情境下會誤導：使用者以為換一張就好，但他換幾張相機拍的
  // 照片都一樣大。而且那是一趟注定失敗的 6 MB 上傳，手機用的還是行動網路。
  it('縮不動又超過上限時，說明是裝置縮不動，而且根本不送出', async () => {
    const page = await open()

    await chooseFile(page, photo('IMG_4823.JPG', 'image/jpeg', CAMERA_PHOTO_BYTES))

    expect(state.postCalls).toBe(0)

    const error = page.get('[data-testid="profile-avatar-error"]').text()

    // happy-dom 沒有 createImageBitmap，卡的是解碼那一關——訊息要指得出是哪一關，
    // 四種原因各說各的話。手機上沒有 console，這句話就是唯一的診斷資訊。
    expect(error).toContain('讀不開')
    // 換一張多小的圖才有用，要說得出數字——這裡正是使用者唯一碰得到 2 MB 的地方
    expect(error).toContain('2 MB')
    expect(error).not.toBe(AVATAR_TOO_LARGE_MESSAGE)
  })

  // 縮圖回報成功、出來的檔案卻仍然超過上限——照理不可能（長邊 512 的 WebP 約 40–80 KB）。
  // 但「照理不可能」正是最該擋的一格：真發生時 server 會回「圖片請控制在 2 MB 以內」，
  // 而那句話會把責任推給使用者選的圖，讓真正的 bug（resizeAvatar 自己）藏起來。
  it('縮完仍然超過上限時，說的是縮完仍過大，而不是把責任推給使用者選的圖', async () => {
    const restore = stubImagePipeline(3 * 1024 * 1024)

    try {
      const page = await open()
      await chooseFile(page, photo('IMG_4823.JPG', 'image/jpeg', CAMERA_PHOTO_BYTES))

      expect(state.postCalls).toBe(0)

      const error = page.get('[data-testid="profile-avatar-error"]').text()

      expect(error).toContain('縮小後仍然超過上限')
      expect(error).not.toContain('這台裝置')
      expect(error).not.toBe(AVATAR_TOO_LARGE_MESSAGE)
    }
    finally {
      restore()
    }
  })

  it('縮不動又超過上限之後，仍可以再選一張小的圖上傳', async () => {
    const page = await open()

    await chooseFile(page, photo('IMG_4823.JPG', 'image/jpeg', CAMERA_PHOTO_BYTES))
    await chooseFile(page, photo('small.jpg', 'image/jpeg', 512 * 1024))

    expect(state.postCalls).toBe(1)
    expect(page.find('[data-testid="profile-avatar-error"]').exists()).toBe(false)
  })

  // Given 我正在上傳頭像
  // When  請求還沒回來
  // Then  顯示處理中狀態，且不能重複送出第二次上傳
  it('上傳中顯示處理中狀態，而且擋掉第二次送出', async () => {
    state.postPending = true
    const page = await open()

    const first = chooseFile(page, photo())
    await vi.waitFor(() => {
      expect(state.resolvePost).not.toBeNull()
    })
    await nextTick()

    expect(page.get('[data-testid="profile-avatar-upload"]').text()).toContain('上傳中')
    expect(page.get('[data-testid="profile-avatar-upload"]').attributes('disabled')).toBeDefined()
    expect(page.find('[data-testid="profile-avatar-busy"]').exists()).toBe(true)

    // 同一拍再選一次：請求還在路上，不能再送一份
    await chooseFile(page, photo())
    expect(state.postCalls).toBe(1)

    state.resolvePost?.()
    await first
    await settle()

    expect(page.get('[data-testid="profile-avatar-upload"]').text()).toContain('更換頭像')
    expect(page.find('[data-testid="profile-avatar-busy"]').exists()).toBe(false)
  })

  // Given server 回 400 / Then「檔案過大」與「格式不支援」是兩則不同的訊息，
  //                          不可一律顯示「上傳失敗」；目前的頭像維持不變
  it('400 的兩種理由各說各的話，頭像維持不變', async () => {
    state.postFailure = { statusCode: 400, message: AVATAR_TOO_LARGE_MESSAGE }
    const page = await open(CUSTOM_AVATAR_PROFILE)

    await chooseFile(page, photo())

    const tooLarge = page.get('[data-testid="profile-avatar-error"]').text()
    expect(tooLarge).toContain(AVATAR_TOO_LARGE_MESSAGE)
    expect(page.get('[data-testid="profile-avatar-image"]').attributes('src')).toBe(CUSTOM_AVATAR)

    state.postFailure = { statusCode: 400, message: AVATAR_UNSUPPORTED_MESSAGE }
    await chooseFile(page, photo('avatar.heic', 'image/heic'))

    const unsupported = page.get('[data-testid="profile-avatar-error"]').text()
    expect(unsupported).toContain(AVATAR_UNSUPPORTED_MESSAGE)
    expect(page.get('[data-testid="profile-avatar-image"]').attributes('src')).toBe(CUSTOM_AVATAR)

    // 折成同一句話的話，換一張小圖再試一次仍然被擋，而畫面說的是同一件事
    expect(unsupported).not.toBe(tooLarge)
    expect(tooLarge).not.toContain('上傳失敗')
    expect(unsupported).not.toContain('上傳失敗')
  })

  it('說不出原因的失敗才退回通用訊息，並可重新上傳', async () => {
    state.postFailure = { statusCode: 500 }
    const page = await open(CUSTOM_AVATAR_PROFILE)

    await chooseFile(page, photo())

    expect(page.get('[data-testid="profile-avatar-error"]').text()).toContain('上傳失敗')
    expect(page.get('[data-testid="profile-avatar-upload"]').text()).toContain('重新上傳')
    expect(page.get('[data-testid="profile-avatar-image"]').attributes('src')).toBe(CUSTOM_AVATAR)

    state.postFailure = null
    await chooseFile(page, photo())

    expect(page.get('[data-testid="profile-avatar-image"]').attributes('src')).toBe(UPLOADED_AVATAR)
    expect(page.find('[data-testid="profile-avatar-error"]').exists()).toBe(false)
  })

  // Given 我選了一張圖後又改變主意，重新選了同一張
  // When  我第二次選取
  // Then  仍然會觸發處理與上傳（file input 的值在每次處理後要被清掉）
  //
  // jsdom / happy-dom 不會重現「值沒清掉就不再送 change」那個行為——真的送出兩次
  // 因此證明不了任何事。驗的是那一步本身：處理過程中有沒有把 input 的值設回空字串。
  it('每次處理完都把 file input 的值清空', async () => {
    const page = await open()

    const { valueResets } = await chooseFile(page, photo())

    expect(valueResets).toContain('')
    expect(state.postCalls).toBe(1)
  })

  it('上傳失敗那一次也照樣清空 file input', async () => {
    state.postFailure = { statusCode: 400, message: AVATAR_UNSUPPORTED_MESSAGE }
    const page = await open()

    const { valueResets } = await chooseFile(page, photo())

    expect(valueResets).toContain('')
  })

  it('沒有選到檔案時什麼都不送', async () => {
    const page = await open()
    const input = page.get('[data-testid="profile-avatar-input"]')

    Object.defineProperty(input.element, 'files', { value: [], configurable: true })
    await input.trigger('change')
    await settle()

    expect(state.postCalls).toBe(0)
    expect(page.find('[data-testid="profile-avatar-error"]').exists()).toBe(false)
  })

  // 訪客上傳一律被 server 擋成 403（GUEST_CANNOT_UPLOAD_AVATAR）。畫面就不該給出
  // 一個按了必定失敗的入口——與訪客沒有改名入口同一個判準。
  it('訪客沒有上傳入口', async () => {
    const page = await open({
      ...GOOGLE_PROFILE,
      displayName: '訪客',
      email: null,
      providers: ['GUEST'],
      avatarUrl: null,
      avatarSource: 'none',
    })

    expect(page.find('[data-testid="profile-avatar-upload"]').exists()).toBe(false)
    expect(page.find('[data-testid="profile-avatar-input"]').exists()).toBe(false)
  })
})

describe('/profile 移除頭像', () => {
  // Given 我沒有自訂頭像
  // When  我開啟 /profile
  // Then  不顯示「移除頭像」這個動作（沒有東西可以移除）
  it('只有 Google 頭像時沒有「移除頭像」', async () => {
    const page = await open()

    expect(page.get('[data-testid="profile-avatar-image"]').attributes('src')).toBe(GOOGLE_AVATAR)
    expect(page.find('[data-testid="profile-avatar-remove"]').exists()).toBe(false)
  })

  it('完全沒有頭像時也沒有「移除頭像」', async () => {
    const page = await open({ ...GOOGLE_PROFILE, avatarUrl: null, avatarSource: 'none' })

    expect(page.find('[data-testid="profile-avatar-remove"]').exists()).toBe(false)
  })

  // Given 我已經有自訂頭像 / When 我按下「移除頭像」並確認
  it('移除要先確認，確認前不送出請求', async () => {
    const page = await open(CUSTOM_AVATAR_PROFILE)

    await page.get('[data-testid="profile-avatar-remove"]').trigger('click')

    const sheet = page.get('[data-testid="avatar-remove-sheet"]')
    expect(sheet.attributes('role')).toBe('dialog')
    expect(state.deleteCalls).toBe(0)

    // 彈窗內容兩行分開顯示
    expect(page.findAll('[data-testid="avatar-remove-line"]')).toHaveLength(2)
  })

  it('在確認彈窗按取消不會移除', async () => {
    const page = await open(CUSTOM_AVATAR_PROFILE)

    await page.get('[data-testid="profile-avatar-remove"]').trigger('click')
    await page.get('[data-testid="avatar-remove-cancel"]').trigger('click')

    expect(state.deleteCalls).toBe(0)
    expect(page.find('[data-testid="avatar-remove-sheet"]').exists()).toBe(false)
    expect(page.get('[data-testid="profile-avatar-image"]').attributes('src')).toBe(CUSTOM_AVATAR)
  })

  // Then 畫面退回 Google 頭像
  it('確認後移除，畫面退回 Google 頭像', async () => {
    const page = await open(CUSTOM_AVATAR_PROFILE)

    await page.get('[data-testid="profile-avatar-remove"]').trigger('click')
    await page.get('[data-testid="avatar-remove-confirm"]').trigger('click')
    await settle()

    expect(state.deleteCalls).toBe(1)
    expect(page.get('[data-testid="profile-avatar-image"]').attributes('src')).toBe(GOOGLE_AVATAR)
    expect(page.find('[data-testid="avatar-remove-sheet"]').exists()).toBe(false)
    // 沒有東西可以移除了
    expect(page.find('[data-testid="profile-avatar-remove"]').exists()).toBe(false)
  })

  // Then 沒有 Google 頭像時退回「訪」之類的名稱首字頭像
  it('沒有 Google 頭像時退回名稱首字頭像', async () => {
    state.deleteResult = { ...CUSTOM_AVATAR_PROFILE, avatarUrl: null, avatarSource: 'none' }
    const page = await open(CUSTOM_AVATAR_PROFILE)

    await page.get('[data-testid="profile-avatar-remove"]').trigger('click')
    await page.get('[data-testid="avatar-remove-confirm"]').trigger('click')
    await settle()

    expect(page.find('img').exists()).toBe(false)
    expect(page.get('[data-testid="profile-avatar-initial"]').text()).toBe('林')
  })

  it('移除失敗時說出原因，頭像維持不變', async () => {
    state.deleteFailure = { statusCode: 500 }
    const page = await open(CUSTOM_AVATAR_PROFILE)

    await page.get('[data-testid="profile-avatar-remove"]').trigger('click')
    await page.get('[data-testid="avatar-remove-confirm"]').trigger('click')
    await settle()

    expect(page.get('[data-testid="profile-avatar-error"]').text()).toContain('移除失敗')
    expect(page.get('[data-testid="profile-avatar-image"]').attributes('src')).toBe(CUSTOM_AVATAR)
  })

  // DELETE 刻意沒有訪客那道 403（見 removeOwnedAvatar）：擋下來只會讓既有的自訂頭像
  // 永遠拿不掉。所以訪客沒有上傳入口，卻仍該拿得掉自己身上那一張。
  it('訪客拿得掉既有的自訂頭像', async () => {
    const page = await open({
      ...GOOGLE_PROFILE,
      displayName: '訪客',
      providers: ['GUEST'],
      avatarUrl: CUSTOM_AVATAR,
      avatarSource: 'custom',
    })

    expect(page.find('[data-testid="profile-avatar-upload"]').exists()).toBe(false)
    expect(page.find('[data-testid="profile-avatar-remove"]').exists()).toBe(true)
  })

  // PR #185 的 review：能上傳頭像的都是 Google 使用者，他們移除後退回的是 Google 頭像，
  // 不是名稱首字——照原本的文案，多數人在按下這個破壞性動作之前看到的是錯的結果。
  //
  // 而 GET /api/profile 只給 avatarUrl 與 avatarSource（見 shared/types/profile.ts），
  // 前端無從得知「移除之後會退回哪一種」。既然說不準，就不要承諾特定來源。
  it('確認文案不承諾會退回哪一種頭像', async () => {
    const page = await open(CUSTOM_AVATAR_PROFILE)

    await page.get('[data-testid="profile-avatar-remove"]').trigger('click')

    const copy = page.findAll('[data-testid="avatar-remove-line"]').map(line => line.text()).join('')

    expect(copy).not.toContain('名稱')
    expect(copy).not.toContain('第一個字')
    // 但「會變成什麼」與「還救得回來」兩件事仍要說到
    expect(copy).toContain('預設頭像')
    expect(copy).toContain('再上傳')
  })

  // PR #185 的 review：移除成功的那一刻，「移除頭像」那顆按鈕自己就不見了
  // （canRemoveAvatar 轉 false），焦點無處可還。還給一個已經脫離 DOM 的元素等於沒還，
  // 鍵盤使用者會掉回 body，得從頁首重新 Tab 一次。
  it('移除成功後焦點落在仍然存在的元素上，不會掉回 body', async () => {
    const page = await open(CUSTOM_AVATAR_PROFILE, true)

    await page.get('[data-testid="profile-avatar-remove"]').trigger('click')
    await page.get('[data-testid="avatar-remove-confirm"]').trigger('click')
    await settle()

    expect(page.find('[data-testid="profile-avatar-remove"]').exists()).toBe(false)
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement?.isConnected).toBe(true)
    expect(document.activeElement).toBe(page.get('[data-testid="profile-avatar-region"]').element)
  })

  // 反過來這一條守著上面那個修法別把原本的行為換掉：按下取消時那顆按鈕還在，
  // 焦點就該回到它身上，而不是被一律送去頭像區塊。
  it('取消時焦點回到「移除頭像」那顆按鈕', async () => {
    const page = await open(CUSTOM_AVATAR_PROFILE, true)
    const remove = page.get('[data-testid="profile-avatar-remove"]')

    ;(remove.element as HTMLElement).focus()
    await remove.trigger('click')
    await page.get('[data-testid="avatar-remove-cancel"]').trigger('click')
    await flushPromises()

    expect(document.activeElement).toBe(remove.element)
  })
})
