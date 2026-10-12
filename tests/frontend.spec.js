// Frontend smoke tests in a real browser (Playwright).
//
//     npm run test:frontend
//
// They cover the browser path (HTTP fallback): the editor opens a screenshot,
// draws it, and the app shell (the folder bar) is in place. The dev servers are
// started by playwright.config.js — port 8090 with a screenshot inside, 8091 empty.

import { test, expect } from '@playwright/test';

const SHOT = 'test-screenshot.png';
const EMPTY_FOLDER_URL = 'http://127.0.0.1:8091/';

test('the editor opens the screenshot it was given', async ({ page }) => {
  await page.goto(`/?file=${encodeURIComponent(SHOT)}`);
  await expect(page.locator('#folder-bar')).toBeVisible();
  await expect(page.locator('#btn-choose-folder')).toBeVisible();
  await expect(page.locator('#toolbar')).toBeVisible();

  // The image is in the editor: the empty state is hidden and the frame is active.
  await expect(page.locator('#empty-state')).toBeHidden({ timeout: 5000 });
  const loaded = await page.evaluate(() => {
    const st = window.editor && window.editor.getState();
    return st && st.image ? { name: st.image.fileName, w: st.image.width, h: st.image.height } : null;
  });
  expect(loaded).not.toBeNull();
  expect(loaded.name).toBe(SHOT);
  expect(loaded.w).toBeGreaterThan(0);
  expect(loaded.h).toBeGreaterThan(0);
});

test('without a file in the address the newest screenshot opens', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#empty-state')).toBeHidden({ timeout: 5000 });
  const name = await page.evaluate(() => {
    const st = window.editor && window.editor.getState();
    return st && st.image ? st.image.fileName : null;
  });
  expect(name).toBe(SHOT);
});

test('an empty watch folder shows the empty state', async ({ page }) => {
  await page.goto(EMPTY_FOLDER_URL);
  await expect(page.locator('#empty-state')).toBeVisible();
  await expect(page.locator('#folder-label')).toContainText('empty');
});

test('in browser mode the quit button is hidden and the folder is shown', async ({ page }) => {
  await page.goto(`/?file=${encodeURIComponent(SHOT)}`);
  await expect(page.locator('#btn-quit')).toBeHidden();
  await expect(page.locator('#folder-label')).not.toHaveText('—');
});
