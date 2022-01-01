import fs from "fs"; // Filesystem
import Jimp from "jimp"; // Image manipulation
import path from "path"; // Path
import axios from "axios"; // Requests
import { ethers } from "ethers"; // Ethers
import FormData from "form-data"; // Data sending
import { logger } from "./utils/logger"; // Logging
import { ERC721ABI } from "./utils/constants"; // Constants
import { promptVerifyContinue } from "./utils/prompt"; // Prompt
import { collectURILocation, URILocation } from "./utils/metadata"; // Metadata helpers

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

  // Pinata API
  pinataJWT: string | undefined;

  /**
   * Initializes Flipper
   * @param {string} rpcURL to retrieve from
   * @param {string} IPFSGateway to retrieve from + store to
   * @param {string} contractAddress of collection
   * @param {string | undefined} pinataJWT optional token
   */
  constructor(
    rpcURL: string,
    IPFSGateway: string,
    contractAddress: string,
    pinataJWT: string | undefined
  ) {
    // Update IPFS Gateway
    this.IPFSGateway = IPFSGateway;
    // Initialize collection contract
    this.contract = new ethers.Contract(
      contractAddress,
      ERC721ABI,
      new ethers.providers.StaticJsonRpcProvider(rpcURL)
    );
    // Update optional Pinata credentials
    this.pinataJWT = pinataJWT;
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
    if (lastFlipped > this.lastScrapedToken) {
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
   * Given a path to a folder and filetype, filter for all files of filetype
   * Then, if preprocessor provided, process all files of filetype
   * Else, push all files to a form data and publish to IPFS
   * @param {string} path of folder
   * @param {string} filetype to filter
   * @param {string} token Pinata JWT
   * @param {Function?} customPreProcess optional preprocesser for files
   * @returns {Promise<string>} IPFS hash of uploaded content
   */
  async pinContent(
    path: string,
    filetype: string,
    token: string,
    customPreProcess?: Function
  ): Promise<string> {
    // Collect all files at path
    const filenames: string[] = fs.readdirSync(path);
    // Filter all files for filetype
    const files: string[] = filenames.filter((filename: string) =>
      filename.endsWith(filetype)
    );

    // Setup data to post
    const formData = new FormData();
    // Push files to data
    for (const file of files) {
      // Run custom processing for each file, if provided
      if (customPreProcess) {
        await customPreProcess(file, path);
      }

      formData.append("file", fs.createReadStream(`${path}/${file}`), {
        // Truncate filepath to just name
        filepath: `output/${file}`
      });
    }

    // Post data
    const {
      // And collect IpfsHash of directory
      data: { IpfsHash }
    }: { data: { IpfsHash: string } } = await axios.post(
      // Post pinFileToIPFS
      "https://api.pinata.cloud/pinning/pinFileToIPFS",
      // With bulk data
      formData,
      {
        // Overload max body to allow infinite images
        maxBodyLength: Infinity,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${formData.getBoundary()}`,
          Authorization: `Bearer ${token}`
        }
      }
    );

    // Return directory
    return IpfsHash;
  }

  /**
   * Given a file path + name and IPFS image hash, modifies image path in file
   * @param {string} imageHash of flipped images
   * @param {string} filename of JSON metadata
   * @param {string} path to JSON metadata
   */
  async processJSON(
    imageHash: string,
    filename: string,
    path: string
  ): Promise<void> {
    // Read file
    const file: Buffer = await fs.readFileSync(`${path}/${filename}`);
    // Read data in file
    const data = JSON.parse(file.toString());
    // Overrwrite file with new image data
    await fs.writeFileSync(
      `${path}/${filename}`,
      JSON.stringify({
        ...data,
        // Overwrite image key with "ipfs://hash/tokenId"
        image: `ipfs://${imageHash}/${filename.slice(0, -5)}.png`
      })
    );
  }

  /**
   * Uploads flipped metadata to IPFS
   * @param {string} token Pinata JWT
   */
  async uploadMetadata(token: string): Promise<void> {
    // Collect paths
    const jsonPath: string = this.getDirectoryPath("flipped");
    const imagePath: string = `${jsonPath}/images`;

    // Upload images to IPFS and log
    const imageHash: string = await this.pinContent(imagePath, ".png", token);
    logger.info(`Uploaded images to ipfs://${imageHash}`);

    // Upload metadata to IPFS and log
    const finalHash: string = await this.pinContent(
      jsonPath,
      ".json",
      token,
      // Custom parser to modify image path in JSON files
      async (filename: string, path: string) =>
        this.processJSON(imageHash, filename, path)
    );
    logger.info(`Uploaded metadata to ipfs://${finalHash}`);
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

    // If provided Pinata token
    if (this.pinataJWT) {
      // Upload new metadata to IPFS
      await this.uploadMetadata(this.pinataJWT);
    }
  }
}
