import { defineConfig } from '@playwright/test'
import common from './playwright.config'

export default defineConfig({
  ...common,
  testMatch:/(bottle-(api|progressive|skins|cameras|scenes|composition|branding)|download|render-startup)\.spec\.ts/,
  outputDir:process.env.THREEDLABS_TEST_OUTPUT??'.cache/qa/bottle-api/tests',
  use:{...common.use,viewport:{width:1440,height:1000}},
})
