import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { logger } from "./logger";
import { create as newIPFS, IPFS } from "ipfs-core";

enum URIType {
  IPFS,
  ARWEAVE,
  HTTPS,
}

const IPFSRegex = RegExp("Qm[1-9A-Za-z]{43}[^OIl]/[0-9]+");
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
    return path.join(
      __dirname,
      `../output/${this.contractAddress}/${folder}/images`
    );
  }

  async setupDirectoryByType(path: string, index: number): Promise<void> {
    // Check if metadata folder exists by path
    const metadataFolder: string = this.getDirectoryPath(path);
    if (!fs.existsSync(metadataFolder)) {
      // If does not exist, create folder
      fs.mkdirSync(metadataFolder, { recursive: true });
      logger.info(`Initializing new ${path} metadata folder`);
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
        index = Math.max(...tokenIds);
        logger.info(`${path} metadata folder exists till token #${index}`);
      } else {
        // Log empty but existing folder
        logger.info(`${path} metadata folder exists but is empty`);
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

    // Else, check if URI contains https
    if (URI.includes("https://")) {
      // Default to HTTPS-type URI
      return { type: URIType.HTTPS, URI };
    }

    // If unknown type of URI, throw
    logger.info("Unsupported URI type: ", URI);
    process.exit(1);
  }

  async scrapeOriginalToken(node: IPFS, tokenId: number): Promise<void> {
    if (tokenId === this.collectionSupply - 1) {
      logger.info("Finished scraping original metadata");
      return;
    }

    const retrievedURI: string = await this.contract.tokenURI(tokenId);

    // TODO: clean URI
    const IPFSStream = node.cat(retrievedURI.slice(7));

    let data = "";
    for await (const buf of IPFSStream) {
      data += buf;
    }
    console.log(JSON.parse(data));

    await this.scrapeOriginalToken(node, tokenId + 1);
  }

  async scrape() {
    // Collect collection details
    await this.collectCollectionDetails();
    logger.info(
      `Scraping ${this.collectionName} collection (supply: ${this.collectionSupply})`
    );

    // Setup output metadata folder
    await this.setupDirectoryByType("original", this.lastScrapedToken);
    // Setup flipped metadata folder
    await this.setupDirectoryByType("flipped", this.lastFlippedToken);

    // Create new IPFS client
    const ipfs = await newIPFS();
    // Scrape original token metadata
    await this.scrapeOriginalToken(ipfs, this.lastScrapedToken);

    // Post-processing (flip images in metadata)
    // Upload new metadata to IPFS
    // Log and save useful metadata details
  }
}
