import { joinPath } from './config.js';

export function agentBundle() {
  return tjs.exePath.replace(/\/Contents\/MacOS\/[^/]+$/, '')
    .replace(/\/Contents\/Resources\/ShotMark Editor\.app$/, '');
}

export const watcherCommand = () => [joinPath(agentBundle(), 'Contents/MacOS/shotmark')];
export const editorBundle = () => joinPath(agentBundle(), 'Contents/Resources/ShotMark Editor.app');
