import { AuthStore } from './auth.store'
import { MarketStore } from './market.store'
import { SettingsStore } from './settings.store'

export class RootStore {
  auth = new AuthStore()
  market = new MarketStore()
  settings = new SettingsStore()
}

export const rootStore = new RootStore()
