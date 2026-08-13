import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import {
  CREATURE_PHOTO_FIELD_NAME,
  CREATURE_PHOTO_TOO_LARGE_MESSAGE,
  CREATURE_PHOTO_UNSUPPORTED_MESSAGE,
} from '#shared/utils/creaturePhotoUpload'
import NewCreaturePage from '../../../app/pages/creatures/new.vue'
import EditCreaturePage from '../../../app/pages/creatures/[id]/edit.vue'
import { AVATAR_OUTPUT_TYPE } from '../../../app/utils/avatarImage'
import { CREATURE_PHOTO_OUTPUT_FILENAME } from '../../../app/utils/creaturePhotoImage'
import { signedInUserSession } from '../support/session'

// 生物照片的表單這一側（issue #154）。
//
// 縮圖本身的規格（長邊 1024、WebP、只縮不放）由 tests/unit/app/resize-creature-photo.test.ts
// 守著，server 端的授權與 Blob 生命週期由 tests/unit/server/creature-photo.test.ts 守著。
// 這一支守的是使用者實際走的那一趟：選一張照片 → 儲存 → 照片真的跟著那一隻走。
//
// 與 profile-avatar.test.ts 同樣的前提：happy-dom 沒有能用的 `createImageBitmap` 與
// canvas，所以**預設**走「縮不動、改送原檔」那條路。要驗縮圖成功的自己架替身
// （`stubImagePipeline`）。

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))

mockNuxtImport('navigateTo', () => navigateToMock)
mockNuxtImport('useUserSession', () => () => signedInUserSession())

interface MockNodeEvent {
  node: { req: { body?: unknown } }
}

interface UploadedFile {
  field: string
  name: string
  type: string
  size: number
}

const EXISTING_PHOTO = 'https://blob.example.test/creatures/creature-1/old.webp'
const UPLOADED_PHOTO = 'https://blob.example.test/creatures/creature-1/new.webp'

const CREATURE = {
  id: 'creature-1',
  tankId: 'tank-1',
  tankName: '主缸',
  name: '火焰仙',
  scientificName: 'Centropyge loriculus',
  category: 'FISH',
  subCategory: '神仙',
  status: 'ALIVE',
  photoUrl: null as string | null,
  addedOn: '2026-08-01',
  price: 1280.5,
  ailment: null,
  observedSickOn: null,
  diedOn: null,
  causeOfDeath: null,
  deathNote: null,
}

const state = {
  providers: ['GOOGLE'] as string[],
  creature: { ...CREATURE } as Record<string, unknown>,
  createCalls: 0,
  updateCalls: 0,
  photoPostCalls: 0,
  photoDeleteCalls: 0,
  uploaded: [] as UploadedFile[],
  photoFailure: null as { statusCode: number, message?: string } | null,
}

registerEndpoint('/api/tanks', () => ({
  tanks: [{ id: 'tank-1', name: '主缸', sizeSpec: null, volumeLiters: null, setupType: null, colorHex: null }],
}))

registerEndpoint('/api/creature-suggestions', () => ({ species: [], subCategories: [] }))

// 表單要知道「這個帳號能不能上傳」才決定給不給入口——訪客一律被 server 擋成 403
registerEndpoint('/api/profile', () => ({
  displayName: '林小海',
  email: 'sea@example.test',
  providers: state.providers,
  createdAt: '2026-01-01T00:00:00.000Z',
  avatarUrl: null,
  avatarSource: 'none',
}))

registerEndpoint('/api/tanks/tank-1/creatures', {
  method: 'POST',
  handler: () => {
    state.createCalls += 1
    return { creature: { ...CREATURE, id: 'creature-new' } }
  },
})

registerEndpoint('/api/creatures/creature-1', () => ({ creature: state.creature }))

registerEndpoint('/api/creatures/creature-1/profile', {
  method: 'PATCH',
  handler: () => {
    state.updateCalls += 1
    return { creature: state.creature }
  },
})

function recordUpload(event: unknown) {
  const body = (event as MockNodeEvent).node.req.body

  if (body instanceof FormData) {
    for (const [field, value] of body.entries()) {
      if (value instanceof File) {
        state.uploaded.push({ field, name: value.name, type: value.type, size: value.size })
      }
    }
  }
}

for (const id of ['creature-new', 'creature-1']) {
  registerEndpoint(`/api/creatures/${id}/photo`, {
    method: 'POST',
    handler: (event) => {
      state.photoPostCalls += 1
      recordUpload(event)

      if (state.photoFailure) {
        throw createError({
          statusCode: state.photoFailure.statusCode,
          statusMessage: 'Creature photo rejected',
          data: state.photoFailure.message ? { message: state.photoFailure.message } : undefined,
        })
      }

      state.creature = { ...state.creature, photoUrl: UPLOADED_PHOTO }
      return { creature: state.creature }
    },
  })

  registerEndpoint(`/api/creatures/${id}/photo`, {
    method: 'DELETE',
    handler: () => {
      state.photoDeleteCalls += 1
      state.creature = { ...state.creature, photoUrl: null }
      return { creature: state.creature }
    },
  })
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  // 預覽網址：happy-dom 的 File 餵不進 Node 的 URL.createObjectURL（它要的是 Node 的
  // Blob）。這是環境的差異，不是行為的——元件那一側已經把預覽做成 best-effort，
  // 所以這裡把它換成替身，才驗得到「選好之後畫面上真的出現預覽」這件事。
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:creature-photo-preview')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

  clearNuxtData()
  clearNuxtState()
  state.providers = ['GOOGLE']
  state.creature = { ...CREATURE }
  state.createCalls = 0
  state.updateCalls = 0
  state.photoPostCalls = 0
  state.photoDeleteCalls = 0
  state.uploaded = []
  state.photoFailure = null
  navigateToMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type Page = VueWrapper<Record<string, unknown>>

/** 處理鏈是「縮圖 → FormData → $fetch」，被攔截的 $fetch 還要再跨一拍才回來 */
async function settle() {
  await flushPromises()
  await flushPromises()
  await nextTick()
}

async function openNew(): Promise<Page> {
  const page = await mountSuspended(NewCreaturePage, { route: '/creatures/new?tank=tank-1' }) as unknown as Page
  await settle()
  return page
}

async function openEdit(): Promise<Page> {
  const page = await mountSuspended(EditCreaturePage, { route: '/creatures/creature-1/edit' }) as unknown as Page
  await settle()
  return page
}

/** 相機拍的原檔尺寸——縮圖存在的理由，也是「縮不動就走不通」的那個大小 */
const CAMERA_PHOTO_BYTES = 6 * 1024 * 1024

function photo(name = 'IMG_4823.JPG', type = 'image/jpeg', bytes = 512 * 1024): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

async function choosePhoto(page: Page, file: File) {
  const input = page.get('[data-testid="creature-photo-input"]')
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

/** 讓縮圖真的縮得出東西：happy-dom 三樣都缺，全部換成替身 */
function stubImagePipeline(encodedBytes = 180 * 1024) {
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

async function fillRequired(page: Page) {
  await page.get('[name="name"]').setValue('火焰仙')
  await page.get('[name="addedOn"]').setValue('2026-08-01')
  await page.get('[data-testid="creature-category-option"][data-category="FISH"]').trigger('click')
}

async function save(page: Page) {
  await page.get('[data-testid="creature-profile-form"]').trigger('submit')
  await settle()
}

// Story：Given 我在新增或編輯生物的表單 / When 我選了一張照片並儲存
//        Then 該生物的 photoUrl 指向已上傳的檔案，列表與詳情頁顯示這張照片
describe('新增生物時附一張照片', () => {
  it('表單有照片欄位，且只收三種格式、不強制叫起相機', async () => {
    const page = await openNew()

    expect(page.get('[data-testid="creature-profile-field"][data-field="photo"]').exists()).toBe(true)

    const input = page.get('[data-testid="creature-photo-input"]')

    expect(input.attributes('type')).toBe('file')
    expect(input.attributes('accept')).toBe('image/jpeg,image/png,image/webp')
    expect(input.attributes('accept')).not.toContain('image/*')
    expect(input.attributes('capture')).toBeUndefined()
    expect(input.attributes('multiple')).toBeUndefined()
    expect(page.get('[data-testid="creature-photo-hint"]').text()).toContain('JPEG')
  })

  it('先建立生物，再把縮好的 WebP 上傳到那一隻，最後進入詳情頁', async () => {
    const restore = stubImagePipeline()

    try {
      const page = await openNew()

      await fillRequired(page)
      await choosePhoto(page, photo('IMG_4823.JPG', 'image/jpeg', CAMERA_PHOTO_BYTES))
      await save(page)

      expect(state.createCalls).toBe(1)
      expect(state.photoPostCalls).toBe(1)
      // 送出的是縮好的那一份，不是 6 MB 的原檔
      expect(state.uploaded).toEqual([{
        field: CREATURE_PHOTO_FIELD_NAME,
        name: CREATURE_PHOTO_OUTPUT_FILENAME,
        type: AVATAR_OUTPUT_TYPE,
        size: 180 * 1024,
      }])
      expect(navigateToMock).toHaveBeenCalledWith('/creatures/creature-new')
    }
    finally {
      restore()
    }
  })

  it('選好照片後表單先顯示預覽，儲存前不送出任何請求', async () => {
    const page = await openNew()

    await choosePhoto(page, photo())

    expect(page.get('[data-testid="creature-photo-preview"]').attributes('src')).toBeTruthy()
    expect(state.photoPostCalls).toBe(0)
    expect(state.createCalls).toBe(0)
  })

  it('沒有選照片時不打照片 API', async () => {
    const page = await openNew()

    await fillRequired(page)
    await save(page)

    expect(state.createCalls).toBe(1)
    expect(state.photoPostCalls).toBe(0)
    expect(navigateToMock).toHaveBeenCalledWith('/creatures/creature-new')
  })

  it('選過之後可以取消選取，取消後不上傳', async () => {
    const page = await openNew()

    await fillRequired(page)
    await choosePhoto(page, photo())
    await page.get('[data-testid="creature-photo-clear"]').trigger('click')
    await save(page)

    expect(page.find('[data-testid="creature-photo-preview"]').exists()).toBe(false)
    expect(state.photoPostCalls).toBe(0)
    expect(state.createCalls).toBe(1)
  })

  it('每次處理完都把 file input 的值清空（同一張圖才選得了第二次）', async () => {
    const page = await openNew()

    const { valueResets } = await choosePhoto(page, photo())

    expect(valueResets).toContain('')
  })
})

// Story：Given 我選的檔案不是允許的圖片型別，或超過大小上限
//        When  我嘗試上傳 / Then 顯示錯誤訊息，儲存被阻擋
describe('照片不合格', () => {
  it('縮不動又超過上限時說明是裝置縮不動，而且儲存被阻擋', async () => {
    const page = await openNew()

    await fillRequired(page)
    await choosePhoto(page, photo('IMG_4823.JPG', 'image/jpeg', CAMERA_PHOTO_BYTES))

    const error = page.get('[data-testid="creature-photo-error"]').text()

    // 手機上沒有 console，這句話是唯一的診斷資訊：卡在哪一關要說得出來
    expect(error).toContain('讀不開')
    expect(error).toContain('2 MB')
    expect(error).not.toBe(CREATURE_PHOTO_TOO_LARGE_MESSAGE)

    await save(page)

    // 儲存被阻擋：生物沒有被建立，照片也沒有送出
    expect(state.createCalls).toBe(0)
    expect(state.photoPostCalls).toBe(0)
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('縮不動且格式不在允許清單時說格式不支援，儲存被阻擋', async () => {
    const page = await openNew()

    await fillRequired(page)
    await choosePhoto(page, photo('scan.pdf', 'application/pdf', 64 * 1024))

    expect(page.get('[data-testid="creature-photo-error"]').text()).toContain(CREATURE_PHOTO_UNSUPPORTED_MESSAGE)

    await save(page)

    expect(state.createCalls).toBe(0)
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('換一張合格的照片之後錯誤消失，又能儲存了', async () => {
    const page = await openNew()

    await fillRequired(page)
    await choosePhoto(page, photo('IMG_4823.JPG', 'image/jpeg', CAMERA_PHOTO_BYTES))
    await choosePhoto(page, photo('small.jpg', 'image/jpeg', 256 * 1024))

    expect(page.find('[data-testid="creature-photo-error"]').exists()).toBe(false)

    await save(page)

    expect(state.createCalls).toBe(1)
    expect(state.photoPostCalls).toBe(1)
  })

  it('取消選取也能解掉錯誤，讓其餘欄位存得下去', async () => {
    const page = await openNew()

    await fillRequired(page)
    await choosePhoto(page, photo('IMG_4823.JPG', 'image/jpeg', CAMERA_PHOTO_BYTES))
    await page.get('[data-testid="creature-photo-clear"]').trigger('click')
    await save(page)

    expect(page.find('[data-testid="creature-photo-error"]').exists()).toBe(false)
    expect(state.createCalls).toBe(1)
    expect(state.photoPostCalls).toBe(0)
  })

  // server 端的 400（繞過前端、或前端與 server 對某個檔案的判斷不一致）要原樣顯示，
  // 而且生物已經建立了——再按一次儲存只該重試照片，不該再建一隻
  it('server 退件時留在表單顯示原因，再按一次儲存不會重複建立生物', async () => {
    state.photoFailure = { statusCode: 400, message: CREATURE_PHOTO_UNSUPPORTED_MESSAGE }
    const page = await openNew()

    await fillRequired(page)
    await choosePhoto(page, photo())
    await save(page)

    expect(state.createCalls).toBe(1)
    expect(state.photoPostCalls).toBe(1)
    expect(navigateToMock).not.toHaveBeenCalled()
    expect(page.get('[data-testid="creature-profile-error"]').text()).toContain(CREATURE_PHOTO_UNSUPPORTED_MESSAGE)

    state.photoFailure = null
    await save(page)

    expect(state.createCalls).toBe(1)
    expect(state.photoPostCalls).toBe(2)
    expect(navigateToMock).toHaveBeenCalledWith('/creatures/creature-new')
  })
})

// Story：Given 我是訪客 / When 我開啟表單
//        Then 照片欄位出現但說明訪客無法上傳
describe('訪客', () => {
  it('沒有上傳入口，但看得到為什麼', async () => {
    state.providers = ['GUEST']
    const page = await openNew()

    expect(page.get('[data-testid="creature-profile-field"][data-field="photo"]').exists()).toBe(true)
    expect(page.find('[data-testid="creature-photo-input"]').exists()).toBe(false)
    expect(page.find('[data-testid="creature-photo-choose"]').exists()).toBe(false)

    const hint = page.get('[data-testid="creature-photo-guest-hint"]').text()

    expect(hint).toContain('訪客')
    expect(hint).toContain('Google')
  })

  it('其餘欄位照常存得下去', async () => {
    state.providers = ['GUEST']
    const page = await openNew()

    await fillRequired(page)
    await save(page)

    expect(state.createCalls).toBe(1)
    expect(state.photoPostCalls).toBe(0)
    expect(navigateToMock).toHaveBeenCalledWith('/creatures/creature-new')
  })

  // DELETE 刻意沒有訪客那道 403（見 removeOwnedCreaturePhoto）：擋下來只會讓
  // 既有的照片（示範資料）永遠拿不掉
  it('拿得掉既有的照片', async () => {
    state.providers = ['GUEST']
    state.creature = { ...CREATURE, photoUrl: EXISTING_PHOTO }
    const page = await openEdit()

    await page.get('[data-testid="creature-photo-remove"]').trigger('click')
    await save(page)

    expect(state.photoDeleteCalls).toBe(1)
  })
})

// Story：Given 我編輯一隻已有照片的生物並換掉照片 / When 儲存成功
//        Then photoUrl 指向新檔案（舊檔案由 server 立即刪除）
describe('編輯既有的照片', () => {
  it('載入時顯示目前的照片', async () => {
    state.creature = { ...CREATURE, photoUrl: EXISTING_PHOTO }
    const page = await openEdit()

    expect(page.get('[data-testid="creature-photo-preview"]').attributes('src')).toBe(EXISTING_PHOTO)
    expect(page.get('[data-testid="creature-photo-choose"]').text()).toContain('更換')
  })

  it('沒有照片時顯示佔位，動作是「選擇照片」', async () => {
    const page = await openEdit()

    expect(page.find('[data-testid="creature-photo-preview"]').exists()).toBe(false)
    expect(page.get('[data-testid="creature-photo-choose"]').text()).toContain('選擇照片')
    expect(page.find('[data-testid="creature-photo-remove"]').exists()).toBe(false)
  })

  it('換一張照片並儲存：先寫基本資料，再上傳新照片', async () => {
    state.creature = { ...CREATURE, photoUrl: EXISTING_PHOTO }
    const page = await openEdit()

    await choosePhoto(page, photo())
    await save(page)

    expect(state.updateCalls).toBe(1)
    expect(state.photoPostCalls).toBe(1)
    expect(state.photoDeleteCalls).toBe(0)
    expect(navigateToMock).toHaveBeenCalledWith('/creatures/creature-1')
  })

  it('移除照片並儲存：打 DELETE，不打上傳', async () => {
    state.creature = { ...CREATURE, photoUrl: EXISTING_PHOTO }
    const page = await openEdit()

    await page.get('[data-testid="creature-photo-remove"]').trigger('click')

    // 儲存之前先在畫面上看得出照片要被拿掉了
    expect(page.find('[data-testid="creature-photo-preview"]').exists()).toBe(false)
    expect(state.photoDeleteCalls).toBe(0)

    await save(page)

    expect(state.photoDeleteCalls).toBe(1)
    expect(state.photoPostCalls).toBe(0)
    expect(state.updateCalls).toBe(1)
    expect(navigateToMock).toHaveBeenCalledWith('/creatures/creature-1')
  })

  it('按了移除又選了新照片時，最後只上傳新照片', async () => {
    state.creature = { ...CREATURE, photoUrl: EXISTING_PHOTO }
    const page = await openEdit()

    await page.get('[data-testid="creature-photo-remove"]').trigger('click')
    await choosePhoto(page, photo())
    await save(page)

    expect(state.photoPostCalls).toBe(1)
    expect(state.photoDeleteCalls).toBe(0)
  })

  it('沒有動照片時兩支照片 API 都不打', async () => {
    state.creature = { ...CREATURE, photoUrl: EXISTING_PHOTO }
    const page = await openEdit()

    await page.get('[name="name"]').setValue('新名字')
    await save(page)

    expect(state.updateCalls).toBe(1)
    expect(state.photoPostCalls).toBe(0)
    expect(state.photoDeleteCalls).toBe(0)
  })

  it('照片上傳失敗時留在表單說明原因，基本資料已經存進去了', async () => {
    state.photoFailure = { statusCode: 500 }
    state.creature = { ...CREATURE, photoUrl: EXISTING_PHOTO }
    const page = await openEdit()

    await choosePhoto(page, photo())
    await save(page)

    expect(state.updateCalls).toBe(1)
    expect(page.get('[data-testid="creature-profile-error"]').text()).toContain('照片')
    expect(navigateToMock).not.toHaveBeenCalled()
  })
})
