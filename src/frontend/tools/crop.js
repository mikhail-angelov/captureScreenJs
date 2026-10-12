// Crop Tool — drag to select, move, and resize crop area

import { BaseTool } from '../tools.js';

export class CropTool extends BaseTool {
  constructor(editor) {
    super('crop', editor);
    this.cropDraft = null;
    this.startPt = null;
    this.startCrop = null;
    this.mode = null;
    this.handle = null;
  }

  activate() {
    super.activate();
    // Draw existing crop if present
    const state = this.editor.getState();
    if (state.crop) {
      this.editor.renderCrop(state.crop);
    }
  }

  deactivate() {
    if (this.editor.getState().crop) {
      this.editor.dispatch({ type: 'CLEAR_CROP' });
      this.editor.renderCrop(null);
    }
    this.cropDraft = null;
    this.startPt = null;
    this.startCrop = null;
    this.mode = null;
    this.handle = null;
    super.deactivate();
  }

  onPointerDown(x, y) {
    const pt = this.screenToImage(x, y);
    const state = this.editor.getState();
    const existingCrop = state.crop;

    if (existingCrop) {
      const handle = this.getHandleAtPoint(existingCrop, pt);
      if (handle) {
        this.mode = 'resize';
        this.handle = handle;
        this.startPt = pt;
        this.startCrop = { ...existingCrop };
        this.cropDraft = { ...existingCrop };
        return;
      }

      if (this.isPointInsideCrop(existingCrop, pt)) {
        this.mode = 'move';
        this.startPt = pt;
        this.startCrop = { ...existingCrop };
        this.cropDraft = { ...existingCrop };
        return;
      }
    }

    this.mode = 'create';
    this.cropDraft = {
      x: pt.x,
      y: pt.y,
      width: 0,
      height: 0
    };
    this.startPt = pt;
  }

  onPointerMove(x, y) {
    if (!this.cropDraft) return;
    const pt = this.screenToImage(x, y);
    const state = this.editor.getState();

    if (this.mode === 'move') {
      this.cropDraft = this.moveCrop(this.startCrop, pt, state.image);
    } else if (this.mode === 'resize') {
      this.cropDraft = this.resizeCrop(this.startCrop, pt, state.image);
    } else {
      this.cropDraft = this.createCrop(this.startPt, pt, state.image);
    }

    this.editor.renderCropDraft(this.cropDraft);
  }

  onPointerUp(x, y) {
    if (!this.cropDraft) return;

    const pt = this.screenToImage(x, y);
    const state = this.editor.getState();

    if (this.mode === 'move') {
      this.cropDraft = this.moveCrop(this.startCrop, pt, state.image);
    } else if (this.mode === 'resize') {
      this.cropDraft = this.resizeCrop(this.startCrop, pt, state.image);
    } else {
      this.cropDraft = this.createCrop(this.startPt, pt, state.image);
    }

    // Ignore tiny crops
    if (this.cropDraft.width < 10 || this.cropDraft.height < 10) {
      this.cropDraft = null;
      this.editor.clearDraft();
      return;
    }

    // Set the crop in state
    this.editor.dispatch({ type: 'SET_CROP', crop: { ...this.cropDraft } });
    this.editor.renderCrop(this.cropDraft);
    this.cropDraft = null;
    this.startCrop = null;
    this.mode = null;
    this.handle = null;
  }

  async applyCrop() {
    const crop = this.editor.getState().crop;
    if (!crop) return;
    await this.editor.applyCrop(crop);
    this.cropDraft = null;
    this.startCrop = null;
    this.mode = null;
    this.handle = null;
  }

  cancelCrop() {
    this.editor.dispatch({ type: 'CLEAR_CROP' });
    this.editor.clearDraft();
    this.editor.renderCrop(null);
  }

  resetCrop() {
    this.cancelCrop();
  }

  createCrop(start, pt, image) {
    return this.clampCrop({
      x: Math.min(start.x, pt.x),
      y: Math.min(start.y, pt.y),
      width: Math.abs(pt.x - start.x),
      height: Math.abs(pt.y - start.y)
    }, image);
  }

  moveCrop(crop, pt, image) {
    const dx = pt.x - this.startPt.x;
    const dy = pt.y - this.startPt.y;
    return this.clampCrop({
      ...crop,
      x: crop.x + dx,
      y: crop.y + dy
    }, image);
  }

  resizeCrop(crop, pt, image) {
    let left = crop.x;
    let top = crop.y;
    let right = crop.x + crop.width;
    let bottom = crop.y + crop.height;

    if (this.handle.includes('w')) left = pt.x;
    if (this.handle.includes('e')) right = pt.x;
    if (this.handle.includes('n')) top = pt.y;
    if (this.handle.includes('s')) bottom = pt.y;

    if (left > right) [left, right] = [right, left];
    if (top > bottom) [top, bottom] = [bottom, top];

    return this.clampCrop({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    }, image);
  }

  clampCrop(crop, image) {
    if (!image) return crop;

    const maxW = image.width;
    const maxH = image.height;
    const width = Math.min(Math.max(0, Math.round(crop.width)), maxW);
    const height = Math.min(Math.max(0, Math.round(crop.height)), maxH);
    const x = Math.min(Math.max(0, Math.round(crop.x)), maxW - width);
    const y = Math.min(Math.max(0, Math.round(crop.y)), maxH - height);

    return { x, y, width, height };
  }

  getHandleAtPoint(crop, pt) {
    const handles = [
      ['nw', crop.x, crop.y],
      ['n', crop.x + crop.width / 2, crop.y],
      ['ne', crop.x + crop.width, crop.y],
      ['e', crop.x + crop.width, crop.y + crop.height / 2],
      ['se', crop.x + crop.width, crop.y + crop.height],
      ['s', crop.x + crop.width / 2, crop.y + crop.height],
      ['sw', crop.x, crop.y + crop.height],
      ['w', crop.x, crop.y + crop.height / 2]
    ];

    for (const [name, x, y] of handles) {
      if (Math.abs(pt.x - x) <= 12 && Math.abs(pt.y - y) <= 12) {
        return name;
      }
    }
    return null;
  }

  isPointInsideCrop(crop, pt) {
    return pt.x >= crop.x &&
      pt.x <= crop.x + crop.width &&
      pt.y >= crop.y &&
      pt.y <= crop.y + crop.height;
  }
}
