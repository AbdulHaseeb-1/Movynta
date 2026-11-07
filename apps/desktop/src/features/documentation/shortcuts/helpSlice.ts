import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

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

export const { setShortcutsOpen } = helpSlice.actions;
export const helpReducer = helpSlice.reducer;
