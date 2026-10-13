// ShotMark Hit Testing — determine which operation was clicked
import { getTextBounds } from './text-metrics.js';

export class HitTester {
  constructor(editor) {
    this.editor = editor;
  }

  // Find operation at image coordinates
  hitTest(x, y) {
    const state = this.editor.getState();

    // Check operations in reverse order (topmost first)
    for (let i = state.operations.length - 1; i >= 0; i--) {
      const op = state.operations[i];
      if (this.hitTestOperation(op, x, y)) {
        return op;
      }
    }

    return null;
  }

  hitTestOperation(op, x, y) {
    switch (op.type) {
      case 'arrow':
        return this.hitTestArrow(op, x, y);
      case 'shape':
        return this.hitTestShape(op, x, y);
      case 'text':
        return this.hitTestText(op, x, y);
      case 'marker':
        return this.hitTestMarker(op, x, y);
      case 'blur':
        return this.hitTestBlur(op, x, y);
      default:
        return false;
    }
  }

  hitTestArrow(op, x, y) {
    const margin = Math.max(op.width, 8);
    return this.pointToSegmentDistance(x, y, op.from.x, op.from.y, op.to.x, op.to.y) < margin;
  }

  pointToSegmentDistance(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;

    if (len2 === 0) {
      return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    }

    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));

    const projX = x1 + t * dx;
    const projY = y1 + t * dy;

    return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
  }

  hitTestShape(op, x, y) {
    const margin = Math.max(op.strokeWidth, 6);
    const bounds = {
      left: op.x - margin,
      right: op.x + op.width + margin,
      top: op.y - margin,
      bottom: op.y + op.height + margin
    };

    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) {
      return false;
    }

    // For fills, inside counts too
    if (op.fill === 'solid' &&
        x >= op.x && x <= op.x + op.width &&
        y >= op.y && y <= op.y + op.height) {
      return true;
    }

    // Check near the stroke
    if (op.shape === 'ellipse') {
      const cx = op.x + op.width / 2;
      const cy = op.y + op.height / 2;
      const rx = op.width / 2 + margin;
      const ry = op.height / 2 + margin;
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      return (dx * dx + dy * dy) <= 1;
    }

    // Rectangle: check near edge
    const nearLeft = Math.abs(x - op.x) <= margin && y >= op.y && y <= op.y + op.height;
    const nearRight = Math.abs(x - op.x - op.width) <= margin && y >= op.y && y <= op.y + op.height;
    const nearTop = Math.abs(y - op.y) <= margin && x >= op.x && x <= op.x + op.width;
    const nearBottom = Math.abs(y - op.y - op.height) <= margin && x >= op.x && x <= op.x + op.width;

    return nearLeft || nearRight || nearTop || nearBottom;
  }

  hitTestText(op, x, y) {
    const bounds = getTextBounds(op);
    const margin = 4;
    return x >= bounds.x - margin && x <= bounds.x + bounds.width + margin &&
           y >= bounds.y - margin && y <= bounds.y + bounds.height + margin;
  }

  hitTestMarker(op, x, y) {
    const margin = Math.max(op.width, 10);
    for (let i = 0; i < op.points.length - 1; i++) {
      const p1 = op.points[i];
      const p2 = op.points[i + 1];
      if (this.pointToSegmentDistance(x, y, p1.x, p1.y, p2.x, p2.y) < margin) {
        return true;
      }
    }
    return false;
  }

  hitTestBlur(op, x, y) {
    const margin = 4;
    return x >= op.x - margin && x <= op.x + op.width + margin &&
           y >= op.y - margin && y <= op.y + op.height + margin;
  }
}
