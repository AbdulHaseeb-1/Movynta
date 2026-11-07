import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "./store";

/** A dispatch hook typed for the app's store. */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
/** A selector hook typed for the app's state. */
export const useAppSelector = useSelector.withTypes<RootState>();
