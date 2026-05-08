import { test as setup } from '@playwright/test';
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
  // Wait for either the auth form OR the portal (if already logged in)
  const landed = await page.waitForSelector('#authEmail, #portal, #courseList, #welcomeState', {
    timeout: 20000
  });

  const id = await landed.getAttribute('id');
  const isAuthForm = id === 'authEmail' || await page.locator('#authEmail').isVisible().catch(() => false);

  if (isAuthForm) {
    await page.locator('#authEmail').fill(email);
    await page.locator('#authPassword').fill(password);
    await page.locator('#authSubmit').click();
    await page.waitForSelector('#portal, #courseList, #welcomeState', { timeout: 20000 });
  } else {
    console.log('[auth.setup] Already authenticated — saving existing session');
  }

  await page.context().storageState({ path: AUTH_FILE });
  console.log('[auth.setup] Session saved to', AUTH_FILE);
});
