import fs from "fs";
import path from "path";
import axios from "axios";
import { ethers } from "ethers";
import { logger } from "./utils/logger";
import { ERC721ABI } from "./utils/constants";
import { collectURILocation, URILocation } from "./utils/metadata";

export default class Flipper {
  IPFSGateway: string;
  contractAddress: string;
  contract: ethers.Contract;

  collectionName: string = "";
  collectionSupply: number = 0;

  lastScrapedToken: number = 0;
  lastFlippedToken: number = 0;

  constructor(rpcURL: string, IPFSGateway: string, contractAddress: string) {
    this.IPFSGateway = IPFSGateway;
    this.contractAddress = contractAddress;
    const rpcProvider = new ethers.providers.StaticJsonRpcProvider(rpcURL);
    this.contract = new ethers.Contract(
      contractAddress,
      ERC721ABI,
      rpcProvider
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

  getDirectoryPath(folder: string): string {
    return path.join(__dirname, `../output/${this.contractAddress}/${folder}`);
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

  async getHTTPMetadata(uri: string): Promise<Record<any, any>> {
    const { data } = await axios.get(uri);
    return data;
  }

  async getAndSaveHTTPImage(uri: string, path: string): Promise<void> {
    const { data } = await axios.get(uri, { responseType: "stream" });
    const writer = data.pipe(fs.createWriteStream(path));
    return new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  }

  async getHTTPImage(uri: string): Promise<string> {
    const { data } = await axios.get(uri, { responseType: "arraybuffer" });
    return Buffer.from(data, "binary").toString("base64");
  }

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

    // Post-processing (flip images in metadata)
    // Upload new metadata to IPFS
    // Log and save useful metadata details
  }
}
