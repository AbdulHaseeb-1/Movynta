import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/** The state of the shortcuts dialog: whether it is open. */
export interface HelpState {
  /** Whether the keyboard shortcuts dialog is open. */
  shortcutsOpen: boolean;
}

const initialState: HelpState = { shortcutsOpen: false };

const helpSlice = createSlice({
  name: "help",
  initialState,
  reducers: {
    setShortcutsOpen(state, action: PayloadAction<boolean>) {
      state.shortcutsOpen = action.payload;
    },
  },
});

/** The action that opens or closes the shortcuts dialog. */
export const { setShortcutsOpen } = helpSlice.actions;
/** The reducer for the shortcuts dialog state. */
export const helpReducer = helpSlice.reducer;
