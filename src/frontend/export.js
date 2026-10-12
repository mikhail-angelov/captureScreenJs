// ShotMark Export — final PNG rendering and clipboard/save

import { getTextFont, measureTextWidth } from './text-metrics.js';
import { call, inApp, hasDialogs } from './api.js';

export class Exporter {
  constructor(editor) {
    this.editor = editor;
  }

  // Render final image to offscreen canvas at original image resolution
  renderFinalImage() {
    const state = this.editor.getState();
    if (!state.image) return null;

    const w = state.image.width;
    const h = state.image.height;

    // Determine output dimensions
    let outW, outH, offsetX = 0, offsetY = 0;

    if (state.crop) {
      outW = state.crop.width;
      outH = state.crop.height;
      offsetX = state.crop.x;
      offsetY = state.crop.y;
    } else {
      outW = w;
      outH = h;
    }

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');

    // Draw the image (cropped region or full)
    ctx.drawImage(state.image.img, offsetX, offsetY, outW, outH, 0, 0, outW, outH);

    // Apply blur operations
    this.renderBlurToCanvas(ctx, state, offsetX, offsetY, outW, outH);

    // Apply marker operations
    this.renderMarkersToCanvas(ctx, state, offsetX, offsetY);

    // Apply SVG-like operations (arrows, shapes, text) by rendering to temp canvas
    this.renderVectorOpsToCanvas(ctx, state, offsetX, offsetY);

    return canvas;
  }

  renderBlurToCanvas(ctx, state, offsetX, offsetY, outW, outH) {
    state.operations.forEach(op => {
      if (op.type !== 'blur') return;

      // Clip to visible area
      const bx = op.x - offsetX;
      const by = op.y - offsetY;
      const bw = op.width;
      const bh = op.height;

      if (bx + bw <= 0 || by + bh <= 0 || bx >= outW || by >= outH) return;

      const clipX = Math.max(0, bx);
      const clipY = Math.max(0, by);
      const clipW = Math.min(bw, outW - clipX);
      const clipH = Math.min(bh, outH - clipY);

      if (clipW <= 0 || clipH <= 0) return;

      // Blur the full current image, then copy only the selected region.
      // This matches the live preview and keeps neighboring pixels available at edges.
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = outW;
      tempCanvas.height = outH;
      const tempCtx = tempCanvas.getContext('2d');

      tempCtx.save();
      tempCtx.filter = `blur(${op.radius}px)`;
      tempCtx.drawImage(ctx.canvas, 0, 0, outW, outH);
      tempCtx.restore();

      const blurredData = tempCtx.getImageData(clipX, clipY, clipW, clipH);
      ctx.putImageData(blurredData, clipX, clipY);
    });
  }

  renderMarkersToCanvas(ctx, state, offsetX, offsetY) {
    state.operations.forEach(op => {
      if (op.type !== 'marker') return;

      ctx.save();
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = op.opacity;

      ctx.beginPath();
      if (op.points.length > 0) {
        const p0 = op.points[0];
        ctx.moveTo(p0.x - offsetX, p0.y - offsetY);
        for (let i = 1; i < op.points.length; i++) {
          const p = op.points[i];
          ctx.lineTo(p.x - offsetX, p.y - offsetY);
        }
      }
      ctx.stroke();
      ctx.restore();
    });
  }

  renderVectorOpsToCanvas(ctx, state, offsetX, offsetY) {
    state.operations.forEach(op => {
      switch (op.type) {
        case 'arrow':
          this.renderArrowToCanvas(ctx, op, offsetX, offsetY);
          break;
        case 'shape':
          this.renderShapeToCanvas(ctx, op, offsetX, offsetY);
          break;
        case 'text':
          this.renderTextToCanvas(ctx, op, offsetX, offsetY);
          break;
      }
    });
  }

  renderArrowToCanvas(ctx, op, ox, oy) {
    const x1 = op.from.x - ox;
    const y1 = op.from.y - oy;
    const x2 = op.to.x - ox;
    const y2 = op.to.y - oy;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const angle = Math.atan2(dy, dx);
    const headLen = 14 + op.width;
    const baseX = x2 - headLen * Math.cos(angle);
    const baseY = y2 - headLen * Math.sin(angle);
    const hx1 = x2 - headLen * Math.cos(angle - 0.45);
    const hy1 = y2 - headLen * Math.sin(angle - 0.45);
    const hx2 = x2 - headLen * Math.cos(angle + 0.45);
    const hy2 = y2 - headLen * Math.sin(angle + 0.45);

    ctx.save();
    ctx.strokeStyle = op.color;
    ctx.fillStyle = op.color;
    ctx.lineWidth = op.width;
    ctx.lineCap = 'butt';

    if (op.style === 'dashed') {
      ctx.setLineDash([8, 4]);
    }

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(baseX, baseY);
    ctx.stroke();

    // Arrow head
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(hx1, hy1);
    ctx.lineTo(hx2, hy2);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  renderShapeToCanvas(ctx, op, ox, oy) {
    const x = op.x - ox;
    const y = op.y - oy;
    const w = op.width;
    const h = op.height;

    ctx.save();
    ctx.strokeStyle = op.stroke;
    ctx.lineWidth = op.strokeWidth;

    if (op.fill === 'solid') {
      ctx.fillStyle = op.stroke;
      ctx.globalAlpha = 0.2;
    }

    ctx.beginPath();
    switch (op.shape) {
      case 'rectangle':
        ctx.rect(x, y, w, h);
        break;
      case 'rounded-rect': {
        const r = Math.min(12, w * 0.2, h * 0.2);
        ctx.roundRect(x, y, w, h, r);
        break;
      }
      case 'ellipse':
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        break;
      case 'line':
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y + h);
        ctx.stroke();
        ctx.restore();
        return;
    }

    if (op.fill === 'solid') ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  renderTextToCanvas(ctx, op, ox, oy) {
    const x = op.x - ox;
    const y = op.y - oy;

    ctx.save();
    ctx.font = getTextFont(op);
    ctx.textBaseline = 'bottom';

    if (op.background) {
      const tw = measureTextWidth(op);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(x - 4, y - op.fontSize + 4, tw + 8, op.fontSize + 8);
    }

    ctx.fillStyle = op.color;
    ctx.fillText(op.text, x, y);

    ctx.restore();
  }

  // Copy final image to clipboard: в приложении — нативно (NSPasteboard),
  // в браузере — как раньше, через navigator.clipboard.
  async copyToClipboard() {
    const canvas = this.renderFinalImage();
    if (!canvas) throw new Error('No image to copy');

    if (inApp()) {
      const dataBase64 = canvas.toDataURL('image/png').replace(/^data:[^,]*,/, '');
      await call('copyImage', { dataBase64 });
      return;
    }

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
    } catch (err) {
      throw new Error('Clipboard copy is not available in this browser. Use Save instead.');
    }
  }

  // Save final image: в приложении — системный диалог сохранения и запись через
  // бэкенд; в браузере — как раньше, скачиванием файла.
  async saveToFile() {
    const canvas = this.renderFinalImage();
    if (!canvas) throw new Error('No image to save');

    const state = this.editor.getState();
    const fileName = state.image ? this.sanitizeFileName(state.image.fileName) : 'screenshot.png';

    if (inApp()) {
      const dataBase64 = canvas.toDataURL('image/png').replace(/^data:[^,]*,/, '');
      let dest = null;
      if (hasDialogs()) {
        try {
          dest = await window.tiny.dialog.saveFile({ name: fileName, types: ['png'] });
        } catch (e) {
          dest = await window.tiny.dialog.saveFile();
        }
      }
      if (!dest) return null; // пользователь отменил
      await call('savePng', { path: dest, dataBase64 });
      return dest;
    }

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return fileName;
  }

  // Sanitize filename per spec
  sanitizeFileName(original) {
    // Remove extension
    let name = original.replace(/\.\w+$/, '');

    // NFC normalize
    name = name.normalize('NFC');

    // Trim whitespace
    name = name.trim();

    // Replace every character except letters, numbers, dot, underscore, hyphen
    name = name.replace(/[^a-zA-Z0-9._-]/g, '-');

    // Collapse repeated hyphens
    name = name.replace(/-+/g, '-');

    // Trim leading/trailing dots and hyphens
    name = name.replace(/^[.-]+|[.-]+$/g, '');

    // If empty, use 'screenshot'
    if (!name) name = 'screenshot';

    // Prefix with shotmark-
    return 'shotmark-' + name + '.png';
  }
}
