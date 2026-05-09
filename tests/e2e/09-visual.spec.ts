import { test, expect } from '@playwright/test';
import { AppPage } from './pages/AppPage';

// Visual regression tests — compare screenshots against stored baselines.
// Run `npx playwright test --update-snapshots` once to create initial baselines.
// After that, any unintended CSS/layout change will fail these tests.

test.describe('Visual regression', () => {
  test('landing / auth page matches baseline', async ({ page }) => {
    // Visit without auth so we always hit the landing/login UI
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500); // let fonts and CSS settle

    await expect(page).toHaveScreenshot('landing.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.03
    });
  });

  test('course overview matches baseline', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();

    const hasCourses = await page
      .locator('#sdCourseList .sd-course-card')
      .first()
      .isVisible({ timeout: 8000 })
      .catch(() => false);

    if (!hasCourses) {
      test.skip(true, 'No courses — cannot capture course overview screenshot');
      return;
    }

    await app.openFirstCourse();
    await expect(page.locator('#courseOverview')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    await expect(page.locator('#courseOverview')).toHaveScreenshot('course-overview.png', {
      maxDiffPixelRatio: 0.03
    });
  });

  test('PDF viewer matches baseline', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();

    const hasCourses = await page
      .locator('#sdCourseList .sd-course-card')
      .first()
      .isVisible({ timeout: 8000 })
      .catch(() => false);
    if (!hasCourses) { test.skip(true, 'No courses'); return; }

    await app.openFirstCourse();
    const hasFile = await page.locator('.co-file').first().isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasFile) { test.skip(true, 'No files'); return; }

    await app.openFirstFile();
    await expect(page.locator('#pdfView')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(1000); // let PDF render

    await expect(page.locator('#pdfView')).toHaveScreenshot('pdf-viewer.png', {
      maxDiffPixelRatio: 0.04
    });
  });
});
