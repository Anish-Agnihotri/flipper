import Flipper from "./flipper"; // Flipper
import * as dotenv from "dotenv"; // Env vars
import { logger } from "./utils/logger"; // Logging

// Setup env
dotenv.config();

(async () => {
  // Collect environment variables
  const rpcURL: string | undefined = process.env.RPC;
  const IPFSGateway: string | undefined = process.env.IPFS;
  const contractAddress: string | undefined = process.env.CONTRACT;
  const pinataJWT: string | undefined = process.env.PINATA_JWT;

  // If missing env vars
  if (!rpcURL || !IPFSGateway || !contractAddress) {
    // Throw error and exit
    logger.error("Missing required parameters, update .env");
    process.exit(1);
  }

  // Setup flipper and process
  const flipper = new Flipper(rpcURL, IPFSGateway, contractAddress, pinataJWT);
  await flipper.process();
})();
