// ShotMark Tools — base tool infrastructure

export class BaseTool {
  constructor(name, editor) {
    this.name = name;
    this.editor = editor;
    this.isActive = false;
    this.draft = null;
  }

  activate() {
    this.isActive = true;
    this.editor.selectionLayer.style.cursor = 'crosshair';
  }

  deactivate() {
    this.isActive = false;
    this.draft = null;
    this.editor.selectionLayer.style.cursor = 'default';
  }

  onPointerDown(x, y, event) {}
  onPointerMove(x, y, event) {}
  onPointerUp(x, y, event) {}

  getSelectionLayer() {
    return this.editor.selectionLayer;
  }

  // Convert screen coordinates to image pixel coordinates
  screenToImage(screenX, screenY) {
    const frame = this.editor.imageFrame;
    const rect = frame.getBoundingClientRect();
    const zoom = this.editor.getState().viewport.zoom;

    const frameX = (screenX - rect.left) / zoom;
    const frameY = (screenY - rect.top) / zoom;

    return { x: Math.round(frameX), y: Math.round(frameY) };
  }
}

// Tool registry
export class ToolRegistry {
  constructor() {
    this.tools = {};
  }

  register(name, tool) {
    this.tools[name] = tool;
  }

  get(name) {
    return this.tools[name];
  }

  getAll() {
    return this.tools;
  }
}
