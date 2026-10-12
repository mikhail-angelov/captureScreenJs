// Marker Tool — freehand semi-transparent stroke

import { nextOpId } from '../state.js';
import { BaseTool } from '../tools.js';

export class MarkerTool extends BaseTool {
  constructor(editor) {
    super('marker', editor);
  }

  onPointerDown(x, y) {
    const pt = this.screenToImage(x, y);
    const state = this.editor.getState();
    const opts = state.tool.options;

    this.draft = {
      type: 'marker',
      id: nextOpId(),
      points: [{ x: pt.x, y: pt.y }],
      color: opts.color,
      width: opts.width,
      opacity: opts.opacity
    };
  }

  onPointerMove(x, y) {
    if (!this.draft) return;
    const pt = this.screenToImage(x, y);

    // Add point (simplify: skip if too close)
    const last = this.draft.points[this.draft.points.length - 1];
    const dx = pt.x - last.x;
    const dy = pt.y - last.y;
    if (dx * dx + dy * dy > 25) { // skip if < 5px away
      this.draft.points.push({ x: pt.x, y: pt.y });
    }

    this.editor.renderDraft(this.draft);
  }

  onPointerUp(x, y) {
    if (!this.draft) return;

    // Add final point
    const pt = this.screenToImage(x, y);
    this.draft.points.push({ x: pt.x, y: pt.y });

    // Ignore if too few points
    if (this.draft.points.length < 2) {
      this.draft = null;
      this.editor.clearDraft();
      return;
    }

    this.editor.dispatch({ type: 'ADD_OPERATION', operation: { ...this.draft } });
    this.draft = null;
    this.editor.clearDraft();
  }
}
