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
