// Shape Tool — rectangle, rounded rect, ellipse, line

import { nextOpId } from '../state.js';
import { BaseTool } from '../tools.js';

export class ShapeTool extends BaseTool {
  constructor(editor) {
    super('shape', editor);
  }

  onPointerDown(x, y) {
    const pt = this.screenToImage(x, y);
    const state = this.editor.getState();
    const opts = state.tool.options;

    this.draft = {
      type: 'shape',
      id: nextOpId(),
      shape: opts.shapeType,
      x: pt.x,
      y: pt.y,
      width: 0,
      height: 0,
      stroke: opts.color,
      strokeWidth: opts.strokeWidth,
      fill: opts.fill
    };

    this.startPt = pt;
  }

  onPointerMove(x, y) {
    if (!this.draft) return;
    const pt = this.screenToImage(x, y);

    // Normalize: allow drawing in any direction
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

    // Ignore tiny shapes
    if (this.draft.width < 3 && this.draft.height < 3) {
      this.draft = null;
      this.editor.clearDraft();
      return;
    }

    this.editor.dispatch({ type: 'ADD_OPERATION', operation: { ...this.draft } });
    this.draft = null;
    this.editor.clearDraft();
  }
}
