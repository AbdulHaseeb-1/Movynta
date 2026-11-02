import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export const MAX_IK_CHAIN = 8;
export const DEFAULT_IK_CHAIN = 2;

/**
 * How the workspace shows and edits rigs. `posing` hands the view's clicks and handles to the selected
 * model's bones; `showRig` draws the skeletons whether or not anything is being posed; `ikChain` is
 * how many bones above a joint bend when it is dragged with Move (0 drags the joint alone).
 */
const riggingSlice = createSlice({
  name: "rigging",
  initialState: { showRig: true, posing: false, ikChain: DEFAULT_IK_CHAIN },
  reducers: {
    setShowRig(state, action: PayloadAction<boolean>) {
      state.showRig = action.payload;
    },
    setPosing(state, action: PayloadAction<boolean>) {
      state.posing = action.payload;
    },
    setIkChain(state, action: PayloadAction<number>) {
      state.ikChain = Math.max(0, Math.min(MAX_IK_CHAIN, Math.round(action.payload)));
    },
  },
});

export const { setShowRig, setPosing, setIkChain } = riggingSlice.actions;
export const riggingReducer = riggingSlice.reducer;
