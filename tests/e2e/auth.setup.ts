import { test as setup, expect } from '@playwright/test';
import path from 'path';

const AUTH_FILE = path.join(__dirname, '.auth/user.json');

setup('authenticate', async ({ page }) => {
  const email = process.env.E2E_EMAIL || '';
  const password = process.env.E2E_PASSWORD || '';

  if (!email || !password) {
    throw new Error(
      '[auth.setup] E2E_EMAIL and E2E_PASSWORD must be set.\n' +
      'Run: $env:E2E_EMAIL="test.e2e@studysphere.test"; $env:E2E_PASSWORD="test.test.123"; npm run test:e2e'
    );
  }

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // The app loads auth.html as a fragment — inputs are #authEmail / #authPassword / #authSubmit
  await page.waitForSelector('#authEmail', { timeout: 15000 });
  await page.locator('#authEmail').fill(email);
  await page.locator('#authPassword').fill(password);
  await page.locator('#authSubmit').click();

  // Wait for portal to appear — indicates successful login
  await page.waitForSelector('#portal, #courseList, #welcomeState', { timeout: 20000 });

  await page.context().storageState({ path: AUTH_FILE });
  console.log('[auth.setup] Session saved to', AUTH_FILE);
});
