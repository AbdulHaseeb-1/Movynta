import { configureStore } from "@reduxjs/toolkit";

type PlaceholderState = Readonly<Record<string, never>>;

// Placeholder root reducer until the first feature slice exists. When adding slices,
// replace it with an object of slice reducers, e.g. `reducer: { studio: studioReducer }`.
const placeholderReducer = (state: PlaceholderState = {}): PlaceholderState => state;

export const store = configureStore({
  reducer: placeholderReducer,
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
