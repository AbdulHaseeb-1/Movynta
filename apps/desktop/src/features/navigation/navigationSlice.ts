import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type Page = "home" | "studio";

const navigationSlice = createSlice({
  name: "navigation",
  initialState: { page: "home" as Page },
  reducers: {
    setPage(state, action: PayloadAction<Page>) {
      state.page = action.payload;
    },
  },
});

export const { setPage } = navigationSlice.actions;
export default navigationSlice.reducer;
