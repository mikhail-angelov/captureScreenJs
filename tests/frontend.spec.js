// Дымовые тесты фронтенда в браузере (Playwright).
//
//   node tests/dev-server.mjs &            # или: npm run dev-server
//   npx playwright test                    # нужен установленный playwright
//
// Проверяют браузерный путь (HTTP-фолбэк) — то, что редактор открывает снимок,
// рисует его и что оболочка приложения (полоса с папкой) на месте.

import { test, expect } from '@playwright/test';

const SHOT = 'test-screenshot.png';

test('редактор открывает переданный снимок', async ({ page }) => {
  await page.goto(`/?file=${encodeURIComponent(SHOT)}`);
  await expect(page.locator('#folder-bar')).toBeVisible();
  await expect(page.locator('#btn-choose-folder')).toBeVisible();
  await expect(page.locator('#toolbar')).toBeVisible();

  // Картинка загрузилась в редактор: пустое состояние скрыто, кадр активен.
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

test('в браузерном режиме кнопка выхода скрыта, папка показана', async ({ page }) => {
  await page.goto(`/?file=${encodeURIComponent(SHOT)}`);
  await expect(page.locator('#btn-quit')).toBeHidden();
  await expect(page.locator('#folder-label')).not.toHaveText('—');
});

test('без снимка показывается пустое состояние', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#empty-state')).toBeVisible();
});
