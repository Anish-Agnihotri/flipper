import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { logger } from "./logger";

enum URIType {
  IPFS,
  ARWEAVE,
  HTTPS,
}

const IPFSRegex = RegExp("Qm[1-9A-Za-z]{43}[^OIl](/[0-9]+)?");
const ERC721ABI: string[] = [
  "function name() external view returns (string memory)",
  "function totalSupply() external view returns (uint256)",
  "function tokenURI(uint256) external view returns (string memory)",
];

export default class Flipper {
  contractAddress: string;
  contract: ethers.Contract;

  collectionName: string = "";
  collectionSupply: number = 0;

  lastScrapedToken: number = 0;
  lastFlippedToken: number = 0;

  constructor(rpcURL: string, contractAddress: string) {
    this.contractAddress = contractAddress;
    const rpcProvider = new ethers.providers.StaticJsonRpcProvider(rpcURL);
    this.contract = new ethers.Contract(
      contractAddress,
      ERC721ABI,
      rpcProvider
    );
  }

  async collectCollectionDetails(): Promise<void> {
    this.collectionName = await this.contract.name();
    this.collectionSupply = await this.contract.totalSupply();
  }

  getDirectoryPath(folder: string): string {
    return path.join(__dirname, `../output/${this.contractAddress}/${folder}`);
  }

  setupDirectoryByType(path: string): number {
    // Check if metadata images folder exists by path
    const metadataFolder: string = this.getDirectoryPath(path);
    const metadataImagesFolder: string = metadataFolder + "/images";
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
        // Set index to max tokenId and log
        const index: number = Math.max(...tokenIds);
        logger.info(`${path} metadata folder exists till token #${index}`);
        // Return currently synced index
        return index;
      } else {
        // Log empty but existing folder
        logger.info(`${path} metadata folder exists but is empty`);
        // Return 0 as currently synced index
        return 0;
      }
    }
  }

  collectURIType(URI: string): { type: URIType; URI: string } {
    // Check if URI is IPFS compatible
    const isIPFS = URI.match(IPFSRegex);
    if (isIPFS) {
      // If so, return truncated IPFS URI
      return { type: URIType.IPFS, URI: isIPFS[0] };
    }

    // TODO: Check if URI is Arweave compatible

    // Else, check if URI is https
    if (URI.includes("https://")) {
      // Default to HTTPS-type URI
      return { type: URIType.HTTPS, URI };
    }

    // If unknown type of URI, throw
    logger.info("Unsupported URI type: ", URI);
    process.exit(1);
  }

  async getIPFSMetadata(cid: string): Promise<JSON> {
    if (!this.ipfs) {
      logger.error("IFPS node not started");
      process.exit(1);
    }

    const stream: AsyncIterable<Uint8Array> = this.ipfs.cat(cid);

    let data: string = "";
    for await (const buffer of stream) {
      data += buffer;
    }

    return JSON.parse(data);
  }

  async scrapeOriginalToken(tokenId: number): Promise<void> {
    // If token to scrape >= total supply
    if (tokenId >= this.collectionSupply) {
      // Revert with finished log
      logger.info("Finished scraping original metadata");
      return;
    }

    // Collect token URI from contract
    const retrievedURI: string = await this.contract.tokenURI(tokenId);
    // Collect type of token URI + formatted URI
    const { type, URI } = this.collectURIType(retrievedURI);

    // Collect metadata based on URI type
    let metadata: JSON;
    switch (type) {
      // Case: IPFS
      case URIType.IPFS:
        metadata = await this.getIPFSMetadata(URI);
      // Default case: IPFS
      default:
        metadata = await this.getIPFSMetadata(URI);
    }

    // Get path to original metadata folder
    const originalMetadataFolder: string = this.getDirectoryPath("original");
    // Write metadata JSON file for tokenId
    await fs.writeFileSync(
      `${originalMetadataFolder}/${tokenId}.json`,
      JSON.stringify(metadata)
    );

    // Log retrieval and process next tokenId
    logger.info(`Retrieved token #${tokenId}`);
    await this.scrapeOriginalToken(tokenId + 1);
  }

  async scrape() {
    // Collect collection details
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
