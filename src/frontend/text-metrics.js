// Shared text measurement for SVG preview and canvas export.

const measureCanvas = document.createElement('canvas');
const measureCtx = measureCanvas.getContext('2d');

export function getTextFont(op) {
  return `${op.bold ? 'bold ' : ''}${op.fontSize}px ${op.fontFamily || 'system-ui'}`;
}

export function measureTextWidth(op) {
  measureCtx.font = getTextFont(op);
  return measureCtx.measureText(op.text).width;
}

export function getTextBounds(op) {
  measureCtx.font = getTextFont(op);
  const metrics = measureCtx.measureText(op.text);
  return {
    x: op.x - metrics.actualBoundingBoxLeft,
    y: op.y - metrics.actualBoundingBoxAscent,
    width: metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
    height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
  };
}
