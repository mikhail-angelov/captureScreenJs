// Blur Tool — blur rectangle using canvas filter

import { nextOpId } from '../state.js';
import { BaseTool } from '../tools.js';

export class BlurTool extends BaseTool {
  constructor(editor) {
    super('blur', editor);
  }

  onPointerDown(x, y) {
    const pt = this.screenToImage(x, y);
    const state = this.editor.getState();
    const opts = state.tool.options;

    this.draft = {
      type: 'blur',
      id: nextOpId(),
      x: pt.x,
      y: pt.y,
      width: 0,
      height: 0,
      radius: opts.radius
    };

    this.startPt = pt;
  }

  onPointerMove(x, y) {
    if (!this.draft) return;
    const pt = this.screenToImage(x, y);

    this.draft.x = Math.min(this.startPt.x, pt.x);
    this.draft.y = Math.min(this.startPt.y, pt.y);
    this.draft.width = Math.abs(pt.x - this.startPt.x);
    this.draft.height = Math.abs(pt.y - this.startPt.y);

    this.editor.renderDraft(this.draft);
  }

  onPointerUp(x, y) {
    if (!this.draft) return;

    const pt = this.screenToImage(x, y);
    this.draft.x = Math.min(this.startPt.x, pt.x);
    this.draft.y = Math.min(this.startPt.y, pt.y);
    this.draft.width = Math.abs(pt.x - this.startPt.x);
    this.draft.height = Math.abs(pt.y - this.startPt.y);

    // Ignore tiny blur areas
    if (this.draft.width < 5 || this.draft.height < 5) {
      this.draft = null;
      this.editor.clearDraft();
      return;
    }

    this.editor.dispatch({ type: 'ADD_OPERATION', operation: { ...this.draft } });
    this.draft = null;
    this.editor.clearDraft();
  }
}
