// ShotMark Editor — main editor controller

import { HistoryManager } from './history.js';
import { Renderer } from './render.js';
import { HitTester } from './hit-test.js';
import { Exporter } from './export.js';
import { ToolRegistry } from './tools.js';
import { ArrowTool } from './tools/arrow.js';
import { TextTool } from './tools/text.js';
import { ShapeTool } from './tools/shape.js';
import { MarkerTool } from './tools/marker.js';
import { BlurTool } from './tools/blur.js';
import { CropTool } from './tools/crop.js';

export class Editor {
  constructor() {
    // DOM elements
    this.canvas = document.getElementById('image-canvas');
    this.annotationLayer = document.getElementById('annotation-layer');
    this.selectionLayer = document.getElementById('selection-layer');
    this.textEditorLayer = document.getElementById('text-editor-layer');
    this.imageFrame = document.getElementById('image-frame');
    this.emptyState = document.getElementById('empty-state');

    // Core systems
    this.history = new HistoryManager();
    this.renderer = new Renderer(this);
    this.hitTester = new HitTester(this);
    this.exporter = new Exporter(this);

    // Tool registry
    this.toolRegistry = new ToolRegistry();
    this.currentTool = null;

    // Pointer state
    this.pointerDown = false;
    this.lastPointerX = 0;
    this.lastPointerY = 0;

    // Register tools
    this.registerTools();

    // Bind events
    this.bindEvents();
  }

  registerTools() {
    this.toolRegistry.register('arrow', new ArrowTool(this));
    this.toolRegistry.register('text', new TextTool(this));
    this.toolRegistry.register('shape', new ShapeTool(this));
    this.toolRegistry.register('marker', new MarkerTool(this));
    this.toolRegistry.register('blur', new BlurTool(this));
    this.toolRegistry.register('crop', new CropTool(this));
  }

  bindEvents() {
    // Mouse events on selection layer
    this.selectionLayer.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));

	    // Prevent context menu
	    this.selectionLayer.addEventListener('contextmenu', (e) => e.preventDefault());
	    window.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.onKeyDown(e));

    // Toolbar buttons
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => this.selectTool(btn.dataset.tool));
    });

    // Tool options
    document.getElementById('btn-undo').addEventListener('click', () => this.undo());
    document.getElementById('btn-redo').addEventListener('click', () => this.redo());
    document.getElementById('btn-copy').addEventListener('click', () => this.copyImage());
    document.getElementById('btn-save').addEventListener('click', () => this.saveImage());

    document.getElementById('zoom-select').addEventListener('change', (e) => {
      this.setZoom(e.target.value);
    });

    // Tool-specific option changes
    this.bindToolOptions();
  }

  bindToolOptions() {
    // Arrow options
    document.getElementById('arrow-style').addEventListener('change', (e) => {
      this.dispatch({ type: 'SET_TOOL_OPTION', key: 'arrowStyle', value: e.target.value });
    });
    document.getElementById('arrow-width').addEventListener('input', (e) => {
      document.getElementById('arrow-width-val').textContent = e.target.value;
      this.dispatch({ type: 'SET_TOOL_OPTION', key: 'strokeWidth', value: parseInt(e.target.value) });
    });
    this.bindColorPicker('arrow-color-palette', 'arrow-color-picker', 'color');

    // Text options
    document.getElementById('text-size').addEventListener('input', (e) => {
      document.getElementById('text-size-val').textContent = e.target.value;
      this.dispatch({ type: 'SET_TOOL_OPTION', key: 'fontSize', value: parseInt(e.target.value) });
    });
    this.bindColorPicker('text-color-palette', 'text-color-picker', 'color');
    document.getElementById('text-bold').addEventListener('change', (e) => {
      this.dispatch({ type: 'SET_TOOL_OPTION', key: 'bold', value: e.target.checked });
    });
    document.getElementById('text-background').addEventListener('change', (e) => {
      this.dispatch({ type: 'SET_TOOL_OPTION', key: 'background', value: e.target.checked });
    });

    // Shape options
    document.getElementById('shape-type').addEventListener('change', (e) => {
      this.dispatch({ type: 'SET_TOOL_OPTION', key: 'shapeType', value: e.target.value });
    });
    document.getElementById('shape-stroke').addEventListener('input', (e) => {
      document.getElementById('shape-stroke-val').textContent = e.target.value;
      this.dispatch({ type: 'SET_TOOL_OPTION', key: 'strokeWidth', value: parseInt(e.target.value) });
    });
    this.bindColorPicker('shape-color-palette', 'shape-color-picker', 'color');
    document.getElementById('shape-fill').addEventListener('change', (e) => {
      this.dispatch({ type: 'SET_TOOL_OPTION', key: 'fill', value: e.target.value });
    });

    // Marker options
    document.getElementById('marker-width').addEventListener('input', (e) => {
      document.getElementById('marker-width-val').textContent = e.target.value;
      this.dispatch({ type: 'SET_TOOL_OPTION', key: 'width', value: parseInt(e.target.value) });
    });
    document.getElementById('marker-opacity').addEventListener('input', (e) => {
      document.getElementById('marker-opacity-val').textContent = e.target.value;
      this.dispatch({ type: 'SET_TOOL_OPTION', key: 'opacity', value: parseFloat(e.target.value) });
    });
    this.bindColorPicker('marker-color-palette', 'marker-color-picker', 'color');

    // Blur options
    document.getElementById('blur-radius').addEventListener('input', (e) => {
      document.getElementById('blur-radius-val').textContent = e.target.value;
      this.dispatch({ type: 'SET_TOOL_OPTION', key: 'radius', value: parseInt(e.target.value) });
    });

    // Crop buttons
    document.getElementById('crop-apply').addEventListener('click', () => {
      const cropTool = this.toolRegistry.get('crop');
      cropTool.applyCrop();
    });
    document.getElementById('crop-cancel').addEventListener('click', () => {
      const cropTool = this.toolRegistry.get('crop');
      cropTool.cancelCrop();
    });
    document.getElementById('crop-reset').addEventListener('click', () => {
      const cropTool = this.toolRegistry.get('crop');
      cropTool.resetCrop();
    });
  }

  bindColorPicker(paletteId, pickerId, key) {
    const palette = document.getElementById(paletteId);
    if (!palette) return;

    palette.addEventListener('click', (e) => {
      const swatch = e.target.closest('.color-swatch');
      if (!swatch) return;

      palette.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      this.dispatch({ type: 'SET_TOOL_OPTION', key, value: swatch.dataset.color });
      document.getElementById(pickerId).value = swatch.dataset.color;
    });

    const picker = document.getElementById(pickerId);
    if (picker) {
      picker.addEventListener('input', (e) => {
        this.dispatch({ type: 'SET_TOOL_OPTION', key, value: e.target.value });
        palette.querySelectorAll('.color-swatch').forEach(s => {
          s.classList.toggle('active', s.dataset.color === e.target.value);
        });
      });
    }
  }

  hasUnsavedChanges() {
    const state = this.getState();
    const text = this.toolRegistry.get('text')?.textEditor?.value.trim();
    return !!text || !!state.crop || (state.image &&
      (state.image !== this.savedImage || state.operations !== this.savedOperations));
  }

  markSaved(state = this.getState()) {
    this.savedImage = state.image;
    this.savedOperations = state.operations;
  }

  clearImage() {
    this.toolRegistry.get('text')?.cancelText();
    const url = this.getState().image?.imageUrl;
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    this.history.reset();
    this.canvas.width = this.canvas.height = 1;
    this.imageFrame.classList.remove('has-image');
    this.render();
    this.markSaved();
  }

  async loadImage(imageData) {
    this.clearImage();
    this.dispatch({
      type: 'LOAD_IMAGE',
      image: imageData
    });

    this.markSaved();

    // Show the image frame
    this.imageFrame.classList.add('has-image');
    this.emptyState.style.display = 'none';

    // Fit zoom to window
    this.fitZoom();

    // Set initial tool
    this.selectTool('arrow');
  }

  async applyCrop(crop) {
    const state = this.getState();
    if (!state.image || !crop || crop.width <= 0 || crop.height <= 0) return;

    const normalizedCrop = this.normalizeCrop(crop, state.image.width, state.image.height);
    if (normalizedCrop.width < 1 || normalizedCrop.height < 1) return;

    const canvas = document.createElement('canvas');
    canvas.width = normalizedCrop.width;
    canvas.height = normalizedCrop.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(
      state.image.img,
      normalizedCrop.x,
      normalizedCrop.y,
      normalizedCrop.width,
      normalizedCrop.height,
      0,
      0,
      normalizedCrop.width,
      normalizedCrop.height
    );

    const img = await this.createImageFromCanvas(canvas);
    const current = this.getState();
    if (current.image !== state.image || current.operations !== state.operations || current.crop !== state.crop) return;
    const image = {
      ...state.image,
      img,
      width: normalizedCrop.width,
      height: normalizedCrop.height
    };

    this.dispatch({
      type: 'APPLY_CROP',
      image,
      operations: this.adjustOperationsForCrop(state.operations, normalizedCrop)
    });
    this.fitZoom();
    this.render();
  }

  normalizeCrop(crop, imageWidth, imageHeight) {
    const x = Math.max(0, Math.min(imageWidth - 1, Math.round(crop.x)));
    const y = Math.max(0, Math.min(imageHeight - 1, Math.round(crop.y)));
    const maxWidth = imageWidth - x;
    const maxHeight = imageHeight - y;
    const width = Math.max(1, Math.min(maxWidth, Math.round(crop.width)));
    const height = Math.max(1, Math.min(maxHeight, Math.round(crop.height)));
    return { x, y, width, height };
  }

  createImageFromCanvas(canvas) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to apply crop'));
      img.src = canvas.toDataURL('image/png');
    });
  }

  adjustOperationsForCrop(operations, crop) {
    return operations
      .map(op => this.shiftOperationForCrop(op, crop))
      .filter(Boolean);
  }

  shiftOperationForCrop(op, crop) {
    const shiftPoint = (point) => ({
      x: point.x - crop.x,
      y: point.y - crop.y
    });

    switch (op.type) {
      case 'arrow':
        return { ...op, from: shiftPoint(op.from), to: shiftPoint(op.to) };
      case 'marker':
        return { ...op, points: op.points.map(shiftPoint) };
      case 'shape':
      case 'blur':
      case 'text':
        return { ...op, x: op.x - crop.x, y: op.y - crop.y };
      default:
        return op;
    }
  }

  fitZoom() {
    const state = this.getState();
    if (!state.image) return;

    const workspace = document.getElementById('workspace');
    const maxW = Math.max(1, (workspace?.clientWidth || window.innerWidth) - 48);
    const maxH = Math.max(1, (workspace?.clientHeight || window.innerHeight) - 48);

    let zoom = 1;
    if (state.image.width > maxW || state.image.height > maxH) {
      zoom = Math.min(maxW / state.image.width, maxH / state.image.height);
	      zoom = this.clampZoom(zoom);
	    }

	    zoom = this.clampZoom(zoom);
	    this.dispatch({ type: 'SET_ZOOM', zoom });
	    this.syncZoomSelect(zoom);
	    this.render();
	  }

  selectTool(toolName) {
    // Deactivate current tool
    if (this.currentTool) {
      this.currentTool.deactivate();
    }

    // Update toolbar
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active-tool', btn.dataset.tool === toolName);
    });

    // Show relevant options
    document.querySelectorAll('.tool-options').forEach(el => {
      el.style.display = el.dataset.tool === toolName ? 'flex' : 'none';
    });

    // Dispatch state change
    this.dispatch({ type: 'SET_TOOL', tool: toolName });
    this.syncToolOptions();

    // Activate new tool
    this.currentTool = this.toolRegistry.get(toolName);
    if (this.currentTool) {
      this.currentTool.activate();
    }
    this.render();
  }

  syncToolOptions() {
    const { active, options } = this.getState().tool;
    const panel = document.querySelector(`.tool-options[data-tool="${active}"]`);
    if (!panel) return;
    panel.querySelectorAll('[data-option]').forEach(control => {
      const value = options[control.dataset.option];
      if (control.type === 'checkbox') control.checked = value;
      else control.value = value;
      const label = document.getElementById(control.id + '-val');
      if (label) label.textContent = value;
    });
    panel.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.classList.toggle('active', swatch.dataset.color === options.color);
    });
  }

  // ── Pointer Events ──

  onPointerDown(e) {
    if (e.button !== 0) return; // Left button only
    if (this.trySelectOperation(e.clientX, e.clientY)) return;

    this.pointerDown = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    if (this.currentTool) {
      this.currentTool.onPointerDown(e.clientX, e.clientY, e);
    }
  }

  onPointerMove(e) {
    if (!this.pointerDown) {
      // Hover — check for selection
      return;
    }

    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    if (this.currentTool) {
      this.currentTool.onPointerMove(e.clientX, e.clientY, e);
    }
  }

  onPointerUp(e) {
    if (!this.pointerDown) return;
    this.pointerDown = false;

    if (this.currentTool) {
      this.currentTool.onPointerUp(e.clientX, e.clientY, e);
    }

    this.render();
  }

  trySelectOperation(clientX, clientY) {
    const state = this.getState();
    if (!state.image || state.tool.active === 'crop' || state.tool.active === 'text') {
      return false;
    }

    const pt = this.screenToImagePoint(clientX, clientY, state.viewport.zoom || 1);
    const op = this.hitTester.hitTest(pt.x, pt.y);
    if (op) {
      this.dispatch({ type: 'SELECT_OPERATION', id: op.id });
      this.render();
      return true;
    }

    if (state.selection.operationId) {
      this.dispatch({ type: 'CLEAR_SELECTION' });
      this.render();
    }

    return false;
  }

  // ── Keyboard ──

  onKeyDown(e) {
    const isMeta = e.metaKey || e.ctrlKey;

    // Don't intercept when text editor is focused
    if (document.activeElement && document.activeElement.classList.contains('inline-text-editor')) {
      return;
    }

    if (isMeta && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if (isMeta && e.key === 'Z') {
      e.preventDefault();
      this.redo();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      const state = this.getState();
      if (state.selection.operationId) {
        this.dispatch({ type: 'DELETE_OPERATION', id: state.selection.operationId });
        this.render();
      }
    } else if (e.key === 'Escape') {
      this.dispatch({ type: 'CLEAR_SELECTION' });
      this.render();
    } else if (isMeta && e.key === 'c') {
      e.preventDefault();
      this.copyImage();
    } else if (isMeta && e.key === 's') {
      e.preventDefault();
      this.saveImage();
    } else if (e.key === '+' || e.key === '=') {
      const state = this.getState();
	      const newZoom = this.clampZoom((state.viewport.zoom || 1) + 0.25);
	      this.setZoom(newZoom);
	    } else if (e.key === '-') {
	      const state = this.getState();
	      const newZoom = this.clampZoom((state.viewport.zoom || 1) - 0.25);
	      this.setZoom(newZoom);
    } else if (e.key === '0') {
      this.setZoom(1);
    }
  }

  // ── State ──

  dispatch(action) {
    this.history.dispatch(action);
  }

  getState() {
    return this.history.getState();
  }

  undo() {
    const state = this.history.undo();
    if (state) this.render();
  }

  redo() {
    const state = this.history.redo();
    if (state) this.render();
  }

	  setZoom(zoom) {
	    if (zoom === 'fit') {
	      this.fitZoom();
	      return;
	    }
	    zoom = parseFloat(zoom);
	    zoom = this.clampZoom(zoom);
	    this.dispatch({ type: 'SET_ZOOM', zoom });
	    this.syncZoomSelect(zoom);
	    this.render();
	  }

	  onWheel(e) {
	    if (!this.getState().image) return;
	    if (!e.ctrlKey && !e.metaKey) return;
	    e.preventDefault();

	    const state = this.getState();
	    const oldZoom = state.viewport.zoom || 1;
	    const direction = e.deltaY < 0 ? 1 : -1;
	    const factor = 0.1;
	    const nextZoom = this.clampZoom(oldZoom * (1 + direction * factor));

	    if (nextZoom === oldZoom) return;

	    const workspace = document.getElementById('workspace');
	    const before = this.screenToImagePoint(e.clientX, e.clientY, oldZoom);
	    this.dispatch({ type: 'SET_ZOOM', zoom: nextZoom });
	    this.syncZoomSelect(nextZoom);
	    this.render();

	    const frameRect = this.imageFrame.getBoundingClientRect();
	    const targetLeft = before.x * nextZoom;
	    const targetTop = before.y * nextZoom;
	    workspace.scrollLeft += targetLeft - (e.clientX - frameRect.left);
	    workspace.scrollTop += targetTop - (e.clientY - frameRect.top);
	  }

	  screenToImagePoint(clientX, clientY, zoom) {
	    const rect = this.imageFrame.getBoundingClientRect();
	    return {
	      x: (clientX - rect.left) / zoom,
	      y: (clientY - rect.top) / zoom
	    };
	  }

	  clampZoom(zoom) {
	    return Math.round(Math.max(0.1, Math.min(4, zoom)) * 100) / 100;
	  }

	  syncZoomSelect(zoom) {
	    const select = document.getElementById('zoom-select');
	    const value = String(zoom);
	    const option = Array.from(select.options).find(opt => opt.value === value);
	    select.value = option ? value : 'fit';
	  }

  render() {
    this.renderer.render(this.getState());
  }

  renderDraft(draft) {
    this.renderer.renderDraft(draft);
  }

  renderCrop(crop) {
    this.renderer.renderCrop(crop);
  }

  renderCropDraft(crop) {
    this.renderer.renderCropDraft(crop);
  }

  clearDraft() {
    this.renderer.renderSelection(this.getState());
  }

  // ── Export ──

  async copyImage() {
    const state = this.getState();

    // Commit any active text editor
    const textTool = this.toolRegistry.get('text');
    if (textTool && textTool.textEditor) {
      textTool.commitText();
    }

    // Clear selection for export
    this.dispatch({ type: 'CLEAR_SELECTION' });
    this.render();

    try {
      const exportedState = this.getState();
      await this.exporter.copyToClipboard();
      this.markSaved(exportedState);
      this.showToast('Copied to clipboard');
    } catch (err) {
      this.dispatch({ type: 'SET_ERROR', error: err.message });
      this.showToast(err.message);
    }
  }

  async saveImage() {
    const state = this.getState();

    // Commit any active text editor
    const textTool = this.toolRegistry.get('text');
    if (textTool && textTool.textEditor) {
      textTool.commitText();
    }

    // Clear selection for export
    this.dispatch({ type: 'CLEAR_SELECTION' });
    this.render();

    try {
      const exportedState = this.getState();
      const path = await this.exporter.saveToFile();
      if (path) {
        this.markSaved(exportedState);
        this.showToast('Saved');
      }
    } catch (err) {
      this.dispatch({ type: 'SET_ERROR', error: err.message });
      this.showToast(err.message);
    }
  }

  showToast(message) {
    let toast = document.getElementById('error-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'error-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  }
}
