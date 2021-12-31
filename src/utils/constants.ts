/**
 * @constant {RegExp} IPFSRegex Retrieves IPFS CID from string
 * Pulls base hash + optional `/{tokenID}` suffix
 */
export const IPFSRegex = RegExp("Qm[1-9A-Za-z]{43}[^OIl](/[0-9]+)?");

/**
 * @constant {string[]} ERC721ABI Human-readable ABI of select ERC721 functions
 */
export const ERC721ABI: string[] = [
  "function name() external view returns (string memory)",
  "function totalSupply() external view returns (uint256)",
  "function tokenURI(uint256) external view returns (string memory)"
];
