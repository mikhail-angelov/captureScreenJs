// Browser and native-API regression tests. Run with npm run test:frontend.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const SHOT = 'test-screenshot.png';

test('editor opens the requested screenshot', async ({ page }) => {
  await page.goto(`/?file=${encodeURIComponent(SHOT)}`);
  await expect(page.locator('#folder-bar')).toBeVisible();
  await expect(page.locator('#btn-choose-folder')).toBeVisible();
  await expect(page.locator('#toolbar')).toBeVisible();

  // The loaded image hides the empty state and activates the frame.
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

test('browser mode hides close and shows the folder', async ({ page }) => {
  await page.goto(`/?file=${encodeURIComponent(SHOT)}`);
  await expect(page.locator('#btn-quit')).toBeHidden();
  await expect(page.locator('#folder-label')).not.toHaveText('—');
});

test('empty folder shows the empty state', async ({ page }) => {
  await page.route('**/api/state', route => route.fulfill({ json: { folder: '/empty', shots: [], lastShot: null, launchAtLogin: 'unsupported' } }));
  await page.goto('/');
  await expect(page.locator('#empty-state')).toBeVisible();
});


test('latest screenshot opens without a query parameter', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.editor?.getState()?.image?.fileName)).toBe(SHOT);
});

async function nativePage(page) {
  const dataBase64 = readFileSync(new URL('./test-screenshot.png', import.meta.url)).toString('base64');
  await page.addInitScript(({ dataBase64 }) => {
    window.nativeEvents = {};
    window.revokedUrls = [];
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => { window.revokedUrls.push(url); revoke(url); };
    window.tiny = {
      api: {
        on: (event, handler) => { window.nativeEvents[event] = handler; },
        call: async (method, params = {}) => {
          if (method === 'getState') return { folder: '/shots', launchAtLogin: 'disabled', shots: [], lastShot: 'first.png' };
          if (method === 'editorReady') return { lastShot: 'first.png' };
          if (method === 'readShot') return { name: params.name, path: '/shots/' + params.name };
          if (method === 'readShotBase64') return { name: params.name, dataBase64 };
          if (method === 'listShots') return [];
          throw new Error('Unexpected call: ' + method);
        },
      },
      dialog: { confirm: async () => false },
    };
  }, { dataBase64 });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.editor?.getState()?.image?.fileName)).toBe('first.png');
}

test('rejecting a new screenshot preserves unsaved changes', async ({ page }) => {
  await nativePage(page);
  await page.evaluate(async () => {
    window.editor.history.dispatch({ type: 'ADD_OPERATION', operation: { id: 'keep' } });
    await window.nativeEvents.newShot({ name: 'second.png' });
  });
  const result = await page.evaluate(() => ({
    name: window.editor.getState().image.fileName,
    operation: window.editor.getState().operations[0].id,
  }));
  expect(result).toEqual({ name: 'first.png', operation: 'keep' });
});

test('replacing a fallback image releases the previous blob URL', async ({ page }) => {
  await nativePage(page);
  const oldUrl = await page.evaluate(() => window.editor.getState().image.imageUrl);
  await page.evaluate(() => window.nativeEvents.openShot({ name: 'second.png' }));
  await expect.poll(() => page.evaluate(() => window.editor.getState().image.fileName)).toBe('second.png');
  expect(await page.evaluate(() => window.revokedUrls)).toContain(oldUrl);
});

test('cancelling save preserves unsaved changes and does not show Saved', async ({ page }) => {
  await nativePage(page);
  await page.evaluate(async () => {
    window.editor.history.dispatch({ type: 'ADD_OPERATION', operation: { id: 'keep' } });
    window.tiny.dialog.saveFile = async () => null;
    await window.editor.saveImage();
  });
  expect(await page.evaluate(() => !!window.editor.hasUnsavedChanges())).toBe(true);
  await expect(page.locator('#error-toast')).not.toBeVisible();
});


test('changes made during clipboard export remain unsaved', async ({ page }) => {
  await nativePage(page);
  await page.evaluate(async () => {
    const original = window.tiny.api.call;
    window.tiny.api.call = async (method, params) => {
      if (method === 'copyImage') {
        window.editor.history.dispatch({ type: 'ADD_OPERATION', operation: { id: 'after-export' } });
        return { ok: true };
      }
      return original(method, params);
    };
    await window.editor.copyImage();
  });
  expect(await page.evaluate(() => !!window.editor.hasUnsavedChanges())).toBe(true);
});

test('history lists screenshots and opens the selected file', async ({ page }) => {
  await page.goto('/');
  await page.locator('#btn-history').click();
  await expect(page.locator('#shot-history')).toBeVisible();
  await page.locator('#shot-list button', { hasText: SHOT }).click();
  await expect(page.locator('#shot-history')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.editor?.getState()?.image?.fileName)).toBe(SHOT);
});

test('stale crop cannot restore the previous screenshot', async ({ page }) => {
  await nativePage(page);
  const result = await page.evaluate(async () => {
    const editor = window.editor;
    let finish;
    editor.createImageFromCanvas = () => new Promise(resolve => { finish = resolve; });
    const oldImage = editor.getState().image;
    const crop = editor.applyCrop({ x: 0, y: 0, width: 20, height: 20 });
    await window.nativeEvents.openShot({ name: 'second.png' });
    finish(oldImage.img);
    await crop;
    return { name: editor.getState().image.fileName, width: editor.getState().image.width };
  });
  expect(result.name).toBe('second.png');
  expect(result.width).toBeGreaterThan(20);
});

test('tool controls synchronize after switching tools', async ({ page }) => {
  await nativePage(page);
  await page.locator('[data-tool="shape"].tool-btn').click();
  await page.locator('#shape-type').selectOption('ellipse');
  await page.locator('#shape-fill').selectOption('solid');
  await page.locator('[data-tool="arrow"].tool-btn').click();
  await page.locator('[data-tool="shape"].tool-btn').click();
  await expect(page.locator('#shape-type')).toHaveValue('rounded-rect');
  await expect(page.locator('#shape-fill')).toHaveValue('transparent');
  expect(await page.evaluate(() => window.editor.getState().tool.options.shapeType)).toBe('rounded-rect');
});

for (const tool of ['text', 'shape', 'marker']) {
  test(`${tool} palette updates the active tool color`, async ({ page }) => {
    await nativePage(page);
    await page.locator(`[data-tool="${tool}"].tool-btn`).click();
    const swatch = page.locator(`#${tool}-color-palette .color-swatch`).nth(1);
    const color = await swatch.getAttribute('data-color');
    await swatch.click();
    expect(await page.evaluate(() => window.editor.getState().tool.options.color)).toBe(color);
    await expect(page.locator(`#${tool}-color-picker`)).toHaveValue(color);
  });
}

test('text renders immediately on Enter and is selectable above its baseline', async ({ page }) => {
  await nativePage(page);
  await page.locator('[data-tool="text"].tool-btn').click();
  await page.evaluate(() => {
    const rect = window.editor.imageFrame.getBoundingClientRect();
    window.editor.toolRegistry.get('text').onPointerDown(rect.left + 100, rect.top + 100);
  });
  await page.locator('.inline-text-editor').fill('Review text');
  await page.locator('.inline-text-editor').press('Enter');
  await expect(page.locator('#annotation-layer text')).toHaveText('Review text');
  const result = await page.evaluate(() => {
    const editor = window.editor;
    const op = editor.getState().operations[0];
    const bounds = editor.renderer.getOperationBounds(op);
    return {
      hit: editor.hitTester.hitTestText(op, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
      below: editor.hitTester.hitTestText(op, op.x + 5, op.y + op.fontSize),
    };
  });
  expect(result).toEqual({ hit: true, below: false });
  await page.evaluate(() => {
    const rect = window.editor.imageFrame.getBoundingClientRect();
    window.editor.toolRegistry.get('text').onPointerDown(rect.left + 150, rect.top + 150);
  });
  await page.locator('.inline-text-editor').fill('Cancelled text');
  await page.locator('.inline-text-editor').press('Escape');
  await expect(page.locator('#annotation-layer text')).toHaveText('Review text');
  expect(await page.evaluate(() => window.editor.getState().operations.length)).toBe(1);
});

test('solid shape export keeps borders and lines opaque', async ({ page }) => {
  await nativePage(page);
  const pixel = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 60;
    const ctx = canvas.getContext('2d');
    window.editor.exporter.renderShapeToCanvas(ctx, {
      shape: 'rectangle', x: 10, y: 10, width: 30, height: 30,
      fill: 'solid', stroke: '#ff0000', strokeWidth: 6,
    }, 0, 0);
    const border = [...ctx.getImageData(10, 20, 1, 1).data];
    ctx.clearRect(0, 0, 60, 60);
    window.editor.exporter.renderShapeToCanvas(ctx, {
      shape: 'line', x: 10, y: 10, width: 30, height: 30,
      fill: 'solid', stroke: '#ff0000', strokeWidth: 6,
    }, 0, 0);
    return { border, line: [...ctx.getImageData(20, 20, 1, 1).data] };
  });
  expect(pixel).toEqual({ border: [255, 0, 0, 255], line: [255, 0, 0, 255] });
});

test('blur clipping matches preview and export after crop', async ({ page }) => {
  await nativePage(page);
  const result = await page.evaluate(() => {
    const editor = window.editor;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 60;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 60, 60);
    ctx.fillStyle = '#000000';
    ctx.fillRect(25, 0, 35, 60);
    const before = [...ctx.getImageData(30, 30, 1, 1).data];
    const preview = document.createElement('canvas');
    preview.width = preview.height = 60;
    const previewCtx = preview.getContext('2d');
    previewCtx.drawImage(canvas, 0, 0);
    const operations = [{ type: 'blur', x: -20, y: 0, width: 40, height: 60, radius: 10 }];
    editor.exporter.renderBlurToCanvas(ctx, { operations }, 0, 0);
    editor.renderer.renderBlurOps({ operations }, previewCtx);
    const exported = [...ctx.getImageData(0, 0, 60, 60).data];
    const displayed = [...previewCtx.getImageData(0, 0, 60, 60).data];
    return {
      before,
      outside: [...ctx.getImageData(30, 30, 1, 1).data],
      matches: exported.every((value, index) => value === displayed[index]),
    };
  });
  expect(result.outside).toEqual(result.before);
  expect(result.matches).toBe(true);
});
