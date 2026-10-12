// Arrow Tool

import { nextOpId } from '../state.js';
import { BaseTool } from '../tools.js';

export class ArrowTool extends BaseTool {
  constructor(editor) {
    super('arrow', editor);
  }

  onPointerDown(x, y) {
    const pt = this.screenToImage(x, y);
    const state = this.editor.getState();
    const opts = state.tool.options;

    this.draft = {
      type: 'arrow',
      id: nextOpId(),
      from: { x: pt.x, y: pt.y },
      to: { x: pt.x, y: pt.y },
      color: opts.color,
      width: opts.strokeWidth,
      style: opts.arrowStyle,
      head: 'triangle'
    };
  }

  onPointerMove(x, y) {
    if (!this.draft) return;
    const pt = this.screenToImage(x, y);
    this.draft.to = { x: pt.x, y: pt.y };
    this.editor.renderDraft(this.draft);
  }

  onPointerUp(x, y) {
    if (!this.draft) return;
    const pt = this.screenToImage(x, y);
    this.draft.to = { x: pt.x, y: pt.y };

    // Ignore clicks (too short)
    const dx = this.draft.to.x - this.draft.from.x;
    const dy = this.draft.to.y - this.draft.from.y;
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
      this.draft = null;
      this.editor.clearDraft();
      return;
    }

    this.editor.dispatch({ type: 'ADD_OPERATION', operation: { ...this.draft } });
    this.draft = null;
    this.editor.clearDraft();
  }
}
