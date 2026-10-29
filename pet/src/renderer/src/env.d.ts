import type { PetApi } from '@shared/types'

declare global {
  interface Window {
    /** preload 暴露的桌宠 API（见 src/preload/index.ts）。 */
    petAPI: PetApi
  }
}

export {}
