// ShotMark History Manager (undo/redo)

import { createInitialState, reduce } from './state.js';

const COMMITTED_ACTIONS = new Set([
  'ADD_OPERATION',
  'UPDATE_OPERATION',
  'DELETE_OPERATION',
  'APPLY_CROP'
]);

export class HistoryManager {
  constructor() {
    this.past = [];
    this.present = createInitialState();
    this.future = [];
  }

  getState() {
    return this.present;
  }

  dispatch(action) {
    const nextState = reduce(this.present, action);
    if (nextState === this.present) {
      return nextState;
    }

    if (COMMITTED_ACTIONS.has(action.type)) {
      this.past.push(this.present);
      this.future = [];
    }

    this.present = nextState;
    return nextState;
  }

  undo() {
    if (this.past.length === 0) return null;
    this.future.unshift(this.present);
    this.present = this.past.pop();
    return this.present;
  }

  redo() {
    if (this.future.length === 0) return null;
    this.past.push(this.present);
    this.present = this.future.shift();
    return this.present;
  }

  canUndo() {
    return this.past.length > 0;
  }

  canRedo() {
    return this.future.length > 0;
  }

  reset() {
    this.past = [];
    this.present = createInitialState();
    this.future = [];
  }
}
