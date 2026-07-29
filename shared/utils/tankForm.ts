import type { CreateTankInput } from '../types/tank'

// 建立缸表單的欄位規則。表單（app/pages/tanks/new.vue）與寫入 API
// （server/api/tanks/index.post.ts）共用這一支：規則只寫一次，
// 前端擋掉的與後端擋掉的必然一致，也不必為了驗證多裝一個套件。

/**
 * 代表色的色票。schema.prisma 的 Tank.colorHex 存 #RRGGBB，
 * 這裡給一組固定色票而不是自由選色——缸的代表色是用來「一眼分辨哪個缸」的識別，
 * 色票之間彼此夠遠才有識別度，也不會選出在深色底上看不見的顏色。
 * 第一個沿用 app.config.ts 的主色（screen-1 的 teal-400）。
 */
export const TANK_COLOR_OPTIONS: readonly { hex: string, label: string }[] = [
  { hex: '#2dd4bf', label: '礁綠' },
  { hex: '#38bdf8', label: '海藍' },
  { hex: '#a78bfa', label: '珊瑚紫' },
  { hex: '#fb923c', label: '珊瑚橘' },
  { hex: '#f472b6', label: '海葵粉' },
  { hex: '#facc15', label: '燈光黃' },
]

/** 缸名與尺寸 / 飼養型態都是頁首那一行字，超過這個長度在手機上一定被截斷 */
const TEXT_MAX_LENGTH = 40

/** 家用海水缸的上限；填到這個數量級幾乎都是打錯字（例如把毫升當公升填） */
const VOLUME_MAX_LITERS = 100_000

const HEX_COLOR = /^#[0-9a-f]{6}$/i

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
    return { ok: false, message: '代表色請從色票中選擇。' }
  }

  return {
    ok: true,
    value: {
      name,
      sizeSpec: sizeSpec || null,
      volumeLiters: volume.value,
      setupType: setupType || null,
      colorHex: colorHex || null,
    },
  }
}
