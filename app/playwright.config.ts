import { defineConfig } from '@playwright/test'
import {fileURLToPath} from 'node:url'
import {chromiumPath,renderBrowserArgs} from './server/browser.mjs'

const externalURL=process.env.THREEDLABS_TEST_URL??process.env.BOTTLE_TEST_URL
const baseURL=externalURL??'http://127.0.0.1:5180'

export default defineConfig({
  testDir: './tests',
  testMatch: /\.spec\.ts$/,
  timeout: 180_000,
  workers: 1,
  reporter: 'list',
  outputDir:process.env.THREEDLABS_TEST_OUTPUT??'.cache/qa/e2e/tests',
  use: {
    baseURL,
    viewport: { width: 1440, height: 1080 },
    reducedMotion:'reduce',
    trace: 'retain-on-failure',
    launchOptions:{executablePath:chromiumPath(fileURLToPath(new URL('.',import.meta.url))),args:renderBrowserArgs()},
  },
  webServer: externalURL?undefined:{
    command: 'npm run dev:bottle',
    env:{PORT:'5180',HOST:'127.0.0.1'},
    url: baseURL+'/api/health',
    reuseExistingServer: false,
    timeout: 45_000,
  },
})
