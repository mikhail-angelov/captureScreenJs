// Text Tool — DOM overlay inline editing

import { nextOpId } from '../state.js';
import { BaseTool } from '../tools.js';

export class TextTool extends BaseTool {
  constructor(editor) {
    super('text', editor);
    this.textEditor = null;
  }

  onPointerDown(x, y) {
    // If we already have an active text editor, commit it
    if (this.textEditor) {
      this.commitText();
      return;
    }

    const pt = this.screenToImage(x, y);
    const state = this.editor.getState();
    const opts = state.tool.options;

    // Create DOM text editor overlay
    const editorLayer = document.getElementById('text-editor-layer');
    const frame = this.editor.imageFrame;
    const rect = frame.getBoundingClientRect();
    const zoom = state.viewport.zoom;

    const textarea = document.createElement('textarea');
    textarea.className = 'inline-text-editor';
    if (opts.background) textarea.classList.add('has-background');
    textarea.style.left = (pt.x * zoom) + 'px';
    textarea.style.top = (pt.y * zoom) + 'px';
    textarea.style.fontSize = (opts.fontSize * zoom) + 'px';
    textarea.style.color = opts.color;
    textarea.style.fontWeight = opts.bold ? 'bold' : 'normal';
    textarea.style.width = Math.min(rect.width - pt.x * zoom, 400) + 'px';
    textarea.style.minHeight = (opts.fontSize * zoom * 1.4) + 'px';
    textarea.placeholder = 'Type here...';

	    editorLayer.appendChild(textarea);
	    requestAnimationFrame(() => textarea.focus());

    this.textEditor = textarea;
    this.pendingTextOp = {
      type: 'text',
      id: nextOpId(),
      x: pt.x,
      y: pt.y,
      text: '',
      color: opts.color,
      fontSize: opts.fontSize,
      fontFamily: 'system-ui',
      bold: opts.bold,
      background: opts.background
    };

    // Handle commit on blur
    textarea.addEventListener('blur', () => this.commitText());
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        this.commitText();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelText();
      }
      // Let native Cmd+Z work inside textarea
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.stopPropagation(); // Don't trigger editor undo
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Z') {
        e.stopPropagation(); // Don't trigger editor redo
      }
    });
  }

  commitText() {
    if (!this.textEditor || !this.pendingTextOp) return;

    const text = this.textEditor.value.trim();
    if (text.length > 0) {
      this.pendingTextOp.text = text;
      this.editor.dispatch({ type: 'ADD_OPERATION', operation: { ...this.pendingTextOp } });
    }

    this.textEditor.remove();
    this.textEditor = null;
    this.pendingTextOp = null;
  }

  cancelText() {
    if (this.textEditor) {
      this.textEditor.remove();
      this.textEditor = null;
      this.pendingTextOp = null;
    }
  }

  deactivate() {
    if (this.textEditor) {
      this.commitText();
    }
    super.deactivate();
  }
}
