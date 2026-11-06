import { env } from "../../config/env.js";
import { ApiFootballProvider } from "./providers/apiFootball.js";
import { FootballDataProvider } from "./providers/footballData.js";
import type { FootballProvider } from "./types.js";

function createProvider(): FootballProvider {
  switch (env.FOOTBALL_PROVIDER) {
    case "api-football":
      return new ApiFootballProvider(env.API_FOOTBALL_KEY!, env.APP_TIMEZONE, env.API_FOOTBALL_BOOKMAKER);
    case "football-data":
      return new FootballDataProvider(env.FOOTBALL_DATA_KEY!, env.APP_TIMEZONE);
  }
}

export const footballProvider = createProvider();
