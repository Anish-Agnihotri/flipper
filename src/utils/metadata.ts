import { logger } from "./logger"; // Logging
import { IPFSRegex } from "./constants"; // Constants

// Supported URI locations
export enum URILocation {
  IPFS,
  HTTPS
}

/**
 * Checks a URI for its data location and appropriately formats URI
 * @param {string} URI to check
 * @returns {{ loc: URILocation, URI: string }} loc: location, URI: formatted uri
 * @throws Exits process if an unknown URI is detected
 */
export function collectURILocation(URI: string): {
  loc: URILocation;
  URI: string;
} {
  // Check if URI is IPFS compatible
  const isIPFS = URI.match(IPFSRegex);
  if (isIPFS) {
    // If so, return truncated IPFS URI
    return { loc: URILocation.IPFS, URI: isIPFS[0] };
  }

  // Else, check if URI is https
  if (URI.includes("https://")) {
    // Default to HTTPS-type URI
    return { loc: URILocation.HTTPS, URI };
  }

  // If unknown type of URI, throw
  logger.info("Unsupported URI type: ", URI);
  process.exit(1);
}
