import fs from "fs"; // Filesystem
import Jimp from "jimp"; // Image manipulation
import path from "path"; // Path
import axios from "axios"; // Requests
import { ethers } from "ethers"; // Ethers
import { logger } from "./utils/logger"; // Logging
import { ERC721ABI } from "./utils/constants"; // Constants
import { collectURILocation, URILocation } from "./utils/metadata"; // Metadata helpers
import { promptVerifyContinue } from "./utils/prompt";

export default class Flipper {
  // IPFS Gateway URL
  IPFSGateway: string;

  // Collection contract
  contract: ethers.Contract;

  // Collection details
  collectionName: string = "";
  collectionSupply: number = 0;

  // Scraping + flipping status
  lastScrapedToken: number = 0;
  lastFlippedToken: number = 0;

  /**
   * Initializes Flipper
   * @param {string} rpcURL to retrieve from
   * @param {string} IPFSGateway to retrieve from + store to
   * @param {string} contractAddress of collection
   */
  constructor(rpcURL: string, IPFSGateway: string, contractAddress: string) {
    // Update IPFS Gateway
    this.IPFSGateway = IPFSGateway;
    // Initialize collection contract
    this.contract = new ethers.Contract(
      contractAddress,
      ERC721ABI,
      new ethers.providers.StaticJsonRpcProvider(rpcURL)
    );
  }

  /**
   * Collects collections name and totalSupply
   * Modifies collectionName and collectionSupply global variables
   */
  async collectCollectionDetails(): Promise<void> {
    this.collectionName = await this.contract.name();
    this.collectionSupply = await this.contract.totalSupply();
  }

  /**
   * Generates directory path based on collection contract address and subpath folder
   * @param {string} folder subpath to append ("original" || "flipped")
   * @returns {string} formatted directory full path
   */
  getDirectoryPath(folder: string): string {
    // `~/output/0x.../(original || flipped)`
    return path.join(__dirname, `../output/${this.contract.address}/${folder}`);
  }

  /**
   * Creates necessary folders in directories, as specified
   * Returns max id of token stored in JSON in full path
   * @param {string} path partial ("original" || "flipped")
   * @returns {number} max id of token stored in full path
   */
  setupDirectoryByType(path: string): number {
    // Collect paths for metadata + images folder
    const metadataFolder: string = this.getDirectoryPath(path);
    const metadataImagesFolder: string = metadataFolder + "/images";

    // Check if metadata images folder exists by path
    if (!fs.existsSync(metadataImagesFolder)) {
      // If does not exist, create folder
      fs.mkdirSync(metadataImagesFolder, { recursive: true });
      logger.info(`Initializing new ${path} metadata + images folder`);

      // Return 0 as currently synced index
      return 0;
    } else {
      // If folder does exist, collect all child filenames
      const folderFilenames: string[] = fs.readdirSync(metadataFolder);
      // Process filenames to find all tokenIds
      const tokenIds: number[] = folderFilenames.flatMap((filename: string) => {
        // Select filenames by .json extension
        if (filename.endsWith(".json")) {
          // Return tokenId number
          return Number(filename.slice(0, -5));
        }

        // Else, return empty (if not correct extension)
        return [];
      });

      // If at least 1 tokenId exists in folder
      if (tokenIds.length > 0) {
        // Set max tokenId and log
        const maxTokenId: number = Math.max(...tokenIds);
        logger.info(`${path} metadata folder exists till token #${maxTokenId}`);

        // Return max tokenId
        return maxTokenId;
      } else {
        // Log empty but existing folder
        logger.info(`${path} metadata folder exists but is empty`);

        // Return 0 as currently synced index
        return 0;
      }
    }
  }

  /**
   * Collects metadata from HTTP(s) url (expects JSON response)
   * @param {string} uri to retrieve from
   * @returns {Promise<Record<any, any>>} JSON response
   */
  async getHTTPMetadata(uri: string): Promise<Record<any, any>> {
    const { data } = await axios.get(uri);
    return data;
  }

  /**
   * Collects image from URI, saves to path
   * @param {string} uri to retrieve image from
   * @param {string} path to save image to
   */
  async getAndSaveHTTPImage(uri: string, path: string): Promise<void> {
    // Collect image from URI as a stream
    const { data } = await axios.get(uri, { responseType: "stream" });
    // Pipe stream to a writeable fs stream
    const writer = data.pipe(fs.createWriteStream(path));
    // Appropriately convert writer response to a promise
    return new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  }

  /**
   * Scrapes tokenId of contract
   * Saves metadata to /output/original/{tokenId}.json
   * Saves image to /output/original/images/{tokenId}.png
   * @param {number} tokenId to scrape
   */
  async scrapeOriginalToken(tokenId: number): Promise<void> {
    // If token to scrape >= total supply
    if (tokenId >= this.collectionSupply) {
      // Revert with finished log
      logger.info("Finished scraping original metadata");
      return;
    }

    // Collect token URI from contract
    const URI: string = await this.contract.tokenURI(tokenId);

    // Collect location and formatted URI from URI
    const { loc, URI: formattedURI } = collectURILocation(URI);

    // Collect metadata based on URI location
    // Could use a ternary and skip the switch, but more maintanable long-term
    let metadata: Record<any, any> = {};
    switch (loc) {
      // Case: IPFS
      case URILocation.IPFS:
        metadata = await this.getHTTPMetadata(
          `${this.IPFSGateway}${formattedURI}`
        );
        break;
      // Case: HTTPS
      case URILocation.HTTPS:
        metadata = await this.getHTTPMetadata(formattedURI);
        break;
    }

    // Get relevant paths
    const baseFolder: string = this.getDirectoryPath("original");
    const tokenMetadataPath: string = `${baseFolder}/${tokenId}.json`;
    const tokenImagePath: string = `${baseFolder}/images/${tokenId}.png`;

    // Write metadata to JSON file
    await fs.writeFileSync(tokenMetadataPath, JSON.stringify(metadata));

    // If image details exist in retrieved metadata
    if (metadata["image"]) {
      // Collect image location and formatted URI
      const { loc, URI: imageURI } = collectURILocation(metadata["image"]);

      // Save image to disk based on location
      switch (loc) {
        // Case: IPFS
        case URILocation.IPFS:
          await this.getAndSaveHTTPImage(
            this.IPFSGateway + imageURI,
            tokenImagePath
          );
          break;
        // Case: HTTPS
        case URILocation.HTTPS:
          await this.getAndSaveHTTPImage(imageURI, tokenImagePath);
          break;
      }
    }

    // Log retrieval and process next tokenId
    logger.info(`Retrieved token #${tokenId}`);
    await this.scrapeOriginalToken(tokenId + 1);
  }

  /**
   * Until parity between scraped and flipped tokens, copy metadata and flip images
   */
  async postProcess(lastFlipped: number): Promise<void> {
    // If tokens to flip >= scraped tokens
    if (lastFlipped >= this.lastScrapedToken) {
      // Revert with finished log
      logger.info("Finished generating flipped metadata");
      return;
    }

    // Collect folders
    const srcFolder: string = this.getDirectoryPath("original");
    const destFolder: string = this.getDirectoryPath("flipped");

    // Copy metadata JSON from src to dest
    await fs.copyFileSync(
      `${srcFolder}/${lastFlipped}.json`,
      `${destFolder}/${lastFlipped}.json`
    );

    // Read metadata image from src
    const image = await Jimp.read(`${srcFolder}/images/${lastFlipped}.png`);
    // Flip image horizontally and save to dest
    image.flip(true, false).write(`${destFolder}/images/${lastFlipped}.png`);

    // Log flip and process next tokenId
    logger.info(`Flipped token #${lastFlipped}`);
    await this.postProcess(lastFlipped + 1);
  }

  /**
   * Processes scraping, flipping, and uploading
   */
  async process() {
    // Collect and log collection details
    await this.collectCollectionDetails();
    logger.info(
      `Scraping ${this.collectionName} collection (supply: ${this.collectionSupply})`
    );

    // Setup output metadata folder
    this.lastScrapedToken = await this.setupDirectoryByType("original");
    // Setup flipped metadata folder
    this.lastFlippedToken = await this.setupDirectoryByType("flipped");

    // Scrape original token metadata
    await this.scrapeOriginalToken(this.lastScrapedToken + 1);

    // Post-processing (move metadata and flip images)
    await this.postProcess(this.lastFlippedToken + 1);

    // Post-processing (give time to make manual modifications)
    await promptVerifyContinue(
      "You can make modify the flipped metadata now. Continue? (true/false)"
    );

    // Upload new metadata to IPFS
    // Log and save useful metadata details
  }
}
