/**
 * Run the data pipeline once from the command line.
 *   npm run refresh              full refresh (yesterday's results, today + tomorrow)
 *   npm run refresh -- --force   regenerate combos even if already final
 */
import { runFullRefresh } from "../jobs/pipeline.js";
import { prisma } from "../lib/prisma.js";

const result = await runFullRefresh({ force: process.argv.includes("--force") });
console.log(JSON.stringify(result, null, 2));
await prisma.$disconnect();
