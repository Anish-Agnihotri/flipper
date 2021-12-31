import Flipper from "./flipper"; // Flipper
import * as dotenv from "dotenv"; // Env vars
import { logger } from "./logger"; // Logging

// Setup env
dotenv.config();

(async () => {
  // Collect environment variables
  const rpcURL: string | undefined = process.env.RPC;
  const contractAddress: string | undefined = process.env.CONTRACT;

  // If missing env vars
  if (!rpcURL || !contractAddress) {
    // Throw error and exit
    logger.error("Missing required parameters, update .env");
    process.exit(1);
  }

  // Setup flipper and scrape
  const flipper = new Flipper(rpcURL, contractAddress);
  await flipper.scrape();
})();
