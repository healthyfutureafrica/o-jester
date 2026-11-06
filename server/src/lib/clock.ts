import { env } from "../config/env.js";
import { addDays, localDate } from "./dates.js";

/** Today's calendar date in the app's timezone (YYYY-MM-DD). */
export const appToday = () => localDate(new Date(), env.APP_TIMEZONE);
export const appTomorrow = () => addDays(appToday(), 1);
