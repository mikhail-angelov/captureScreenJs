// Use the same clipping and blur operation for the preview and PNG export.
export function renderBlurRegion(ctx, op, offsetX = 0, offsetY = 0) {
  const x = Math.max(0, op.x - offsetX);
  const y = Math.max(0, op.y - offsetY);
  const right = Math.min(ctx.canvas.width, op.x - offsetX + op.width);
  const bottom = Math.min(ctx.canvas.height, op.y - offsetY + op.height);
  if (right <= x || bottom <= y) return;

  const blurred = document.createElement('canvas');
  blurred.width = ctx.canvas.width;
  blurred.height = ctx.canvas.height;
  const temp = blurred.getContext('2d');
  temp.filter = `blur(${op.radius}px)`;
  temp.drawImage(ctx.canvas, 0, 0);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, right - x, bottom - y);
  ctx.clip();
  ctx.clearRect(x, y, right - x, bottom - y);
  ctx.drawImage(blurred, 0, 0);
  ctx.restore();
}
