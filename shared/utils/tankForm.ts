import type { CreateTankInput } from '../types/tank'

// 建立缸表單的欄位規則。表單（app/pages/tanks/new.vue）與寫入 API
// （server/api/tanks/index.post.ts）共用這一支：規則只寫一次，
// 前端擋掉的與後端擋掉的必然一致，也不必為了驗證多裝一個套件。

/**
 * 代表色的色票，取自設計稿新增缸畫面的那一排圓點（由左至右）。
 * schema.prisma 的 Tank.colorHex 存 #RRGGBB。
 *
 * 色票是「常用捷徑」而不是限制：設計稿在圓點右邊另給了一個自訂色碼輸入框，
 * 所以 parseTankInput 收下任何合法的 #RRGGBB，不檢查它在不在這個清單裡。
 * 第一個沿用 app.config.ts 的主色（screen-1 的 teal-400）。
 */
export const TANK_COLOR_OPTIONS: readonly { hex: string, label: string }[] = [
  { hex: '#2dd4bf', label: '礁綠' },
  { hex: '#3b82f6', label: '海藍' },
  { hex: '#a78bfa', label: '珊瑚紫' },
  { hex: '#f2664e', label: '珊瑚橘' },
  { hex: '#f5b841', label: '燈光黃' },
  { hex: '#34d399', label: '藻綠' },
]

/** 缸名與尺寸 / 飼養型態都是頁首那一行字，超過這個長度在手機上一定被截斷 */
const TEXT_MAX_LENGTH = 40

/** 家用海水缸的上限；填到這個數量級幾乎都是打錯字（例如把毫升當公升填） */
const VOLUME_MAX_LITERS = 100_000

const HEX_COLOR = /^#[0-9a-f]{6}$/i

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export type ParseTankInputResult
  = | { ok: true, value: CreateTankInput }
    | { ok: false, message: string }

function toTrimmedText(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

/**
 * 水量。type=number 的輸入框在不同瀏覽器可能給 number 或字串，兩種都收；
 * 留白（null / undefined / 空字串）視為沒填，而不是 0。
 */
function parseVolume(raw: unknown): { ok: true, value: number | null } | { ok: false, message: string } {
  if (raw === null || raw === undefined || (typeof raw !== 'number' && toTrimmedText(raw) === '')) {
    return { ok: true, value: null }
  }

  // Number('四百二') 是 NaN，Number.isInteger(NaN) 為 false，這裡一併擋掉
  const value = typeof raw === 'number' ? raw : Number(toTrimmedText(raw))

  if (!Number.isInteger(value) || value <= 0 || value > VOLUME_MAX_LITERS) {
    return { ok: false, message: `水量請填 1 到 ${VOLUME_MAX_LITERS} 之間的整數（公升）。` }
  }

  return { ok: true, value }
}

/**
 * 開缸日期。日期選擇器交出來的是 `YYYY-MM-DD`，留白視為沒填。
 *
 * 正規表達式過了還要再比對一次年月日，因為 `new Date('2025-02-30')` 會自己
 * 滾成 3/2 而不是報錯——格式對、日子不存在的輸入得在這裡擋下來。
 */
function parseStartedOn(raw: unknown): { ok: true, value: string | null } | { ok: false, message: string } {
  const text = toTrimmedText(raw)

  if (!text) {
    return { ok: true, value: null }
  }

  const matched = ISO_DATE.exec(text)

  if (matched) {
    const [, year, month, day] = matched as unknown as [string, string, string, string]
    const date = new Date(`${text}T00:00:00.000Z`)

    if (
      !Number.isNaN(date.getTime())
      && date.getUTCFullYear() === Number(year)
      && date.getUTCMonth() + 1 === Number(month)
      && date.getUTCDate() === Number(day)
    ) {
      return { ok: true, value: text }
    }
  }

  return { ok: false, message: '開缸日期請選擇一個實際存在的日期。' }
}

/**
 * 把表單狀態或請求 body 正規化成 CreateTankInput，不合規則時回傳可以直接顯示的訊息。
 * 刻意不丟例外：表單要把訊息畫在欄位下方，API 要把它轉成 400，兩邊都是「正常流程」。
 */
export function parseTankInput(raw: unknown): ParseTankInputResult {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>

  const name = toTrimmedText(source.name)

  if (!name) {
    return { ok: false, message: '請輸入缸名。' }
  }

  if (name.length > TEXT_MAX_LENGTH) {
    return { ok: false, message: `缸名請控制在 ${TEXT_MAX_LENGTH} 字以內。` }
  }

  const sizeSpec = toTrimmedText(source.sizeSpec)

  if (sizeSpec.length > TEXT_MAX_LENGTH) {
    return { ok: false, message: `尺寸請控制在 ${TEXT_MAX_LENGTH} 字以內。` }
  }

  const setupType = toTrimmedText(source.setupType)

  if (setupType.length > TEXT_MAX_LENGTH) {
    return { ok: false, message: `飼養型態請控制在 ${TEXT_MAX_LENGTH} 字以內。` }
  }

  const volume = parseVolume(source.volumeLiters)

  if (!volume.ok) {
    return volume
  }

  const colorHex = toTrimmedText(source.colorHex).toLowerCase()

  if (colorHex && !HEX_COLOR.test(colorHex)) {
    return { ok: false, message: '代表色請選一個色票，或填入 #RRGGBB 格式的色碼。' }
  }

  const startedOn = parseStartedOn(source.startedOn)

  if (!startedOn.ok) {
    return startedOn
  }

  return {
    ok: true,
    value: {
      name,
      sizeSpec: sizeSpec || null,
      volumeLiters: volume.value,
      setupType: setupType || null,
      colorHex: colorHex || null,
      startedOn: startedOn.value,
    },
  }
}
