// ShotMark Rendering — canvas for image, SVG for annotations

import { measureTextWidth, getTextBounds } from './text-metrics.js';
import { renderBlurRegion } from './blur-render.js';

export class Renderer {
  constructor(editor) {
    this.editor = editor;
    this.imageCanvas = document.getElementById('image-canvas');
    this.annotationLayer = document.getElementById('annotation-layer');
    this.selectionLayer = document.getElementById('selection-layer');
    this.ctx = this.imageCanvas.getContext('2d');
  }

  // Main render: draw everything
  render(state) {
    this.renderCanvas(state);
    this.renderSVG(state);
    this.renderSelection(state);
  }

  // Draw the base image and committed operations on canvas
	  renderCanvas(state) {
	    if (!state.image) return;

	    const zoom = state.viewport.zoom;
	    const w = state.image.width;
	    const h = state.image.height;
	    const displayW = w * zoom;
	    const displayH = h * zoom;

	    // Set canvas size to original image dimensions (for pixel-perfect rendering)
	    this.imageCanvas.width = w;
	    this.imageCanvas.height = h;
	    this.imageCanvas.style.width = displayW + 'px';
	    this.imageCanvas.style.height = displayH + 'px';
	    this.imageCanvas.style.transform = 'scale(1)';
	    this.editor.imageFrame.style.width = displayW + 'px';
	    this.editor.imageFrame.style.height = displayH + 'px';
	    this.editor.textEditorLayer.style.width = displayW + 'px';
	    this.editor.textEditorLayer.style.height = displayH + 'px';

    const ctx = this.ctx;

    // Draw the base image
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(state.image.img, 0, 0, w, h);

    // Draw blur operations directly on canvas (they need pixel manipulation)
    this.renderBlurOps(state, ctx);

    // Draw marker operations (semi-transparent, drawn on canvas)
    this.renderMarkerOps(state, ctx);

    // Apply crop visual
    if (state.crop) {
      // Dim outside the crop area
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      // Top
      ctx.fillRect(0, 0, w, state.crop.y);
      // Bottom
      ctx.fillRect(0, state.crop.y + state.crop.height, w, h - state.crop.y - state.crop.height);
      // Left
      ctx.fillRect(0, state.crop.y, state.crop.x, state.crop.height);
      // Right
      ctx.fillRect(state.crop.x + state.crop.width, state.crop.y, w - state.crop.x - state.crop.width, state.crop.height);
    }
  }

  // Render blur operations using canvas filter
  renderBlurOps(state, ctx) {
    for (const op of state.operations) {
      if (op.type === 'blur') renderBlurRegion(ctx, op);
    }
  }

  // Render marker operations (freehand strokes)
  renderMarkerOps(state, ctx) {
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
        ctx.moveTo(op.points[0].x, op.points[0].y);
        for (let i = 1; i < op.points.length; i++) {
          ctx.lineTo(op.points[i].x, op.points[i].y);
        }
      }
      ctx.stroke();
      ctx.restore();
    });
  }

  // Render annotations as SVG (arrow, shape, text)
	  renderSVG(state) {
	    const svg = this.annotationLayer;
	    const zoom = state.viewport.zoom;
	    const w = state.image ? state.image.width : 0;
	    const h = state.image ? state.image.height : 0;

	    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
	    svg.style.width = (w * zoom) + 'px';
	    svg.style.height = (h * zoom) + 'px';
	    svg.style.transform = 'none';

    let html = '';

    state.operations.forEach(op => {
      switch (op.type) {
        case 'arrow':
          html += this.renderArrowSVG(op);
          break;
        case 'shape':
          html += this.renderShapeSVG(op);
          break;
        case 'text':
          html += this.renderTextSVG(op);
          break;
      }
    });

    svg.innerHTML = html;
  }

  renderArrowSVG(op) {
    const dx = op.to.x - op.from.x;
    const dy = op.to.y - op.from.y;
    const angle = Math.atan2(dy, dx);
    const headLen = 14 + op.width;

    const strokeDash = op.style === 'dashed' ? 'stroke-dasharray="8,4"' : '';

    // Arrow head points
    const tipX = op.to.x;
    const tipY = op.to.y;
    const baseX = tipX - headLen * Math.cos(angle);
    const baseY = tipY - headLen * Math.sin(angle);
    const headX1 = tipX - headLen * Math.cos(angle - 0.45);
    const headY1 = tipY - headLen * Math.sin(angle - 0.45);
    const headX2 = tipX - headLen * Math.cos(angle + 0.45);
    const headY2 = tipY - headLen * Math.sin(angle + 0.45);

    return `<g>
      <line x1="${op.from.x}" y1="${op.from.y}" x2="${baseX}" y2="${baseY}"
            stroke="${op.color}" stroke-width="${op.width}" stroke-linecap="butt" ${strokeDash} />
      <polygon points="${tipX},${tipY} ${headX1},${headY1} ${headX2},${headY2}"
               fill="${op.color}" />
    </g>`;
  }

  renderShapeSVG(op) {
    const fillColor = op.fill === 'solid' ? op.stroke : 'none';
    const fillOpacity = op.fill === 'solid' ? '0.2' : '1';

    switch (op.shape) {
      case 'rectangle':
        return `<rect x="${op.x}" y="${op.y}" width="${op.width}" height="${op.height}"
                      stroke="${op.stroke}" stroke-width="${op.strokeWidth}" fill="${fillColor}"
                      fill-opacity="${fillOpacity}" />`;

      case 'rounded-rect':
        const r = Math.min(12, op.width * 0.2, op.height * 0.2);
        return `<rect x="${op.x}" y="${op.y}" width="${op.width}" height="${op.height}" rx="${r}" ry="${r}"
                      stroke="${op.stroke}" stroke-width="${op.strokeWidth}" fill="${fillColor}"
                      fill-opacity="${fillOpacity}" />`;

      case 'ellipse':
        const cx = op.x + op.width / 2;
        const cy = op.y + op.height / 2;
        const rx = op.width / 2;
        const ry = op.height / 2;
        return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"
                        stroke="${op.stroke}" stroke-width="${op.strokeWidth}" fill="${fillColor}"
                        fill-opacity="${fillOpacity}" />`;

      case 'line':
        return `<line x1="${op.x}" y1="${op.y}" x2="${op.x + op.width}" y2="${op.y + op.height}"
                      stroke="${op.stroke}" stroke-width="${op.strokeWidth}" stroke-linecap="round" />`;

      default:
        return '';
    }
  }

  renderTextSVG(op) {
    const bgWidth = measureTextWidth(op) + 8;
    const bg = op.background
      ? `<rect x="${op.x - 4}" y="${op.y - op.fontSize + 4}" width="${bgWidth}" height="${op.fontSize + 8}"
                fill="rgba(255,255,255,0.85)" rx="2" />`
      : '';

    return `<g>${bg}
      <text x="${op.x}" y="${op.y}" fill="${op.color}"
            font-family="${op.fontFamily}" font-size="${op.fontSize}"
            font-weight="${op.bold ? 'bold' : 'normal'}">${this.escapeXml(op.text)}</text>
    </g>`;
  }

  // Render selection overlay (handles, bounding box)
	  renderSelection(state) {
	    const svg = this.selectionLayer;
	    const zoom = state.viewport.zoom;
    const w = state.image ? state.image.width : 0;
    const h = state.image ? state.image.height : 0;

	    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
	    svg.style.width = (w * zoom) + 'px';
	    svg.style.height = (h * zoom) + 'px';
	    svg.style.transform = 'none';

	    if (!state.selection.operationId) {
	      if (state.tool.active === 'crop' && state.crop) {
	        this.renderCrop(state.crop);
	        return;
	      }
	      svg.innerHTML = '';
	      return;
	    }

    const op = state.operations.find(o => o.id === state.selection.operationId);
    if (!op) {
      svg.innerHTML = '';
      return;
    }

    const bounds = this.getOperationBounds(op);
    if (!bounds) return;

    const padding = 4;
    const bx = bounds.x - padding;
    const by = bounds.y - padding;
    const bw = bounds.width + padding * 2;
    const bh = bounds.height + padding * 2;

    let handles = '';

    // Corner handles
    const corners = [
      { x: bx, y: by },           // top-left
      { x: bx + bw, y: by },       // top-right
      { x: bx, y: by + bh },       // bottom-left
      { x: bx + bw, y: by + bh },  // bottom-right
    ];

    corners.forEach((c, i) => {
      handles += `<rect class="handle" x="${c.x - 5}" y="${c.y - 5}" width="10" height="10"
                         data-handle="${i}" />`;
    });

    svg.innerHTML = `
      <rect class="selection-box" x="${bx}" y="${by}" width="${bw}" height="${bh}" />
      ${handles}
    `;
  }

  getOperationBounds(op) {
    switch (op.type) {
      case 'arrow':
        return {
          x: Math.min(op.from.x, op.to.x),
          y: Math.min(op.from.y, op.to.y),
          width: Math.abs(op.to.x - op.from.x) + 10,
          height: Math.abs(op.to.y - op.from.y) + 10
        };
      case 'shape':
      case 'blur':
        return { x: op.x, y: op.y, width: op.width, height: op.height };
      case 'text':
        return getTextBounds(op);
      case 'marker':
        const xs = op.points.map(p => p.x);
        const ys = op.points.map(p => p.y);
        return {
          x: Math.min(...xs) - 5,
          y: Math.min(...ys) - 5,
          width: Math.max(...xs) - Math.min(...xs) + 10,
          height: Math.max(...ys) - Math.min(...ys) + 10
        };
      default:
        return null;
    }
  }

  // Render draft (preview during drawing)
	  renderDraft(draft) {
    if (!draft) return;

    const state = this.editor.getState();
    const svg = this.selectionLayer;
    const zoom = state.viewport.zoom;
    const w = state.image ? state.image.width : 0;
    const h = state.image ? state.image.height : 0;

	    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
	    svg.style.width = (w * zoom) + 'px';
	    svg.style.height = (h * zoom) + 'px';
	    svg.style.transform = 'none';

    let html = '';
    switch (draft.type) {
      case 'arrow':
        html = this.renderArrowSVG(draft);
        break;
      case 'shape':
        html = this.renderShapeSVG(draft);
        break;
      case 'marker':
        // For marker draft, we draw on overlay SVG too
        if (draft.points.length > 1) {
          const pts = draft.points.map(p => `${p.x},${p.y}`).join(' ');
          html = `<polyline points="${pts}" fill="none"
                     stroke="${draft.color}" stroke-width="${draft.width}"
                     stroke-linecap="round" stroke-linejoin="round"
                     opacity="${draft.opacity}" />`;
        }
        break;
      case 'blur':
        html = `<rect x="${draft.x}" y="${draft.y}" width="${draft.width}" height="${draft.height}"
                      fill="rgba(200,200,200,0.3)" stroke="#666" stroke-width="1.5" stroke-dasharray="4,2" />`;
        break;
    }

    svg.innerHTML = html;
  }

  // Render crop frame overlay
	  renderCrop(crop) {
    const svg = this.selectionLayer;
    const state = this.editor.getState();
    const zoom = state.viewport.zoom;
    const w = state.image ? state.image.width : 0;
    const h = state.image ? state.image.height : 0;

	    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
	    svg.style.width = (w * zoom) + 'px';
	    svg.style.height = (h * zoom) + 'px';
	    svg.style.transform = 'none';

    if (!crop) {
      svg.innerHTML = '';
      return;
    }

    // Draw overlay around, and frame + handles on the crop area
    svg.innerHTML = `
      <rect class="crop-overlay" x="0" y="0" width="${w}" height="${crop.y}" />
      <rect class="crop-overlay" x="0" y="${crop.y + crop.height}" width="${w}" height="${h - crop.y - crop.height}" />
      <rect class="crop-overlay" x="0" y="${crop.y}" width="${crop.x}" height="${crop.height}" />
      <rect class="crop-overlay" x="${crop.x + crop.width}" y="${crop.y}" width="${w - crop.x - crop.width}" height="${crop.height}" />
      <rect class="crop-frame" x="${crop.x}" y="${crop.y}" width="${crop.width}" height="${crop.height}" />
      <circle class="crop-handle" data-handle="nw" cx="${crop.x}" cy="${crop.y}" r="7" />
      <circle class="crop-handle" data-handle="n" cx="${crop.x + crop.width / 2}" cy="${crop.y}" r="7" />
      <circle class="crop-handle" data-handle="ne" cx="${crop.x + crop.width}" cy="${crop.y}" r="7" />
      <circle class="crop-handle" data-handle="e" cx="${crop.x + crop.width}" cy="${crop.y + crop.height / 2}" r="7" />
      <circle class="crop-handle" data-handle="se" cx="${crop.x + crop.width}" cy="${crop.y + crop.height}" r="7" />
      <circle class="crop-handle" data-handle="s" cx="${crop.x + crop.width / 2}" cy="${crop.y + crop.height}" r="7" />
      <circle class="crop-handle" data-handle="sw" cx="${crop.x}" cy="${crop.y + crop.height}" r="7" />
      <circle class="crop-handle" data-handle="w" cx="${crop.x}" cy="${crop.y + crop.height / 2}" r="7" />
    `;
  }

  renderCropDraft(crop) {
    this.renderCrop(crop);
  }

  // Render text operation on SVG (re-render after commit)
  renderTextOp(op) {
    // Rendered as part of renderSVG — no separate action needed
  }

  escapeXml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
