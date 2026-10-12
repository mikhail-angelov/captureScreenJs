// ShotMark State Manager
// Immutable EditorState with reducer pattern

export const INITIAL_TOOL_OPTIONS = {
  arrow: { color: '#ff0000', strokeWidth: 4, arrowStyle: 'solid' },
  text: { color: '#000000', fontSize: 24, bold: false, background: false },
  shape: { color: '#ff0000', strokeWidth: 6, shapeType: 'rounded-rect', fill: 'transparent' },
  marker: { color: '#ffff00', width: 18, opacity: 0.45 },
  blur: { radius: 12 },
  crop: {}
};

export function createInitialState() {
  return {
    version: 1,
    image: null,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    tool: {
      active: 'arrow',
      options: { ...INITIAL_TOOL_OPTIONS.arrow }
    },
    selection: { operationId: null, handle: null },
    crop: null,
    operations: [],
    ui: {
      isDragging: false,
      isExporting: false,
      error: null
    }
  };
}

export function reduce(state, action) {
  switch (action.type) {
    case 'LOAD_IMAGE': {
      return {
        ...state,
        image: action.image,
        operations: [],
        crop: null,
        selection: { operationId: null, handle: null },
        viewport: { ...state.viewport, zoom: 1, panX: 0, panY: 0 }
      };
    }

    case 'SET_TOOL': {
      const tool = action.tool;
      const options = INITIAL_TOOL_OPTIONS[tool] || {};
      return {
        ...state,
        tool: { active: tool, options: { ...options } },
        selection: { operationId: null, handle: null }
      };
    }

    case 'SET_TOOL_OPTION': {
      return {
        ...state,
        tool: {
          ...state.tool,
          options: { ...state.tool.options, [action.key]: action.value }
        }
      };
    }

    case 'ADD_OPERATION': {
      return {
        ...state,
        operations: [...state.operations, action.operation]
      };
    }

    case 'UPDATE_OPERATION': {
      return {
        ...state,
        operations: state.operations.map(op =>
          op.id === action.id ? { ...op, ...action.patch } : op
        )
      };
    }

    case 'DELETE_OPERATION': {
      return {
        ...state,
        operations: state.operations.filter(op => op.id !== action.id),
        selection:
          state.selection.operationId === action.id
            ? { operationId: null, handle: null }
            : state.selection
      };
    }

    case 'SELECT_OPERATION': {
      return {
        ...state,
        selection: { operationId: action.id, handle: null }
      };
    }

    case 'SET_SELECTION_HANDLE': {
      return {
        ...state,
        selection: { ...state.selection, handle: action.handle }
      };
    }

    case 'CLEAR_SELECTION': {
      return {
        ...state,
        selection: { operationId: null, handle: null }
      };
    }

    case 'SET_ZOOM': {
      return {
        ...state,
        viewport: { ...state.viewport, zoom: action.zoom }
      };
    }

    case 'SET_CROP': {
      return {
        ...state,
        crop: action.crop
      };
    }

    case 'CLEAR_CROP': {
      return {
        ...state,
        crop: null
      };
    }

    case 'APPLY_CROP': {
      return {
        ...state,
        image: action.image,
        crop: null,
        operations: action.operations || [],
        selection: { operationId: null, handle: null },
        viewport: { ...state.viewport, zoom: 1, panX: 0, panY: 0 }
      };
    }

    case 'SET_DRAGGING': {
      return {
        ...state,
        ui: { ...state.ui, isDragging: action.isDragging }
      };
    }

    case 'SET_EXPORTING': {
      return {
        ...state,
        ui: { ...state.ui, isExporting: action.isExporting }
      };
    }

    case 'SET_ERROR': {
      return {
        ...state,
        ui: { ...state.ui, error: action.error }
      };
    }

    default:
      return state;
  }
}

// Generate unique operation IDs
let _opCounter = 0;
export function nextOpId() {
  return 'op_' + (++_opCounter) + '_' + Date.now().toString(36);
}
