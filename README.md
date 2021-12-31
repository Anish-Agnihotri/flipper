# Flipper

Allows scraping [ERC721](https://eips.ethereum.org/EIPS/eip-721) tokens for their metadata and images, flipping images and uploading new metadata to IPFS.

**Metadata retrieval:**

- Supports both IPFS and centralized metadata stores
- Supports retrieving and storing images from IPFS and centralized sources in source quality
- You can stop Flipper at any time and pick back up where you left off, in the future.

## Usage

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.sample .env

# Edit environment variables
vim .env

# Run flipper
npm run start
```

### IPFS

A majority of Ethereum NFT metadata is stored via IPFS. While you can use a public IPFS gateway with these scripts, you will be quickly rate-limited.

As such, it is recommended to run your own local node (<1m setup time):

```bash
# Install ipfs
# Mac:
brew install ipfs
# Debian
apt install ipfs -y

# Initialize
ipfs init

# Start daemon
ipfs daemon
```

Or, to get a private gateway from a provider like [Pinata](https://www.pinata.cloud/pricing) ($20/month).

Flipped metadata is also stored on IPFS. It is recommended to use a gateway from a pinning service, so you do not lose your metadata upon killing your local daemon.

## Potential expansions

- [ ] Support retrieving metadata and images from Arweave (comply with `ar://` standard)
- [ ] Support storing flipped metadata and images on Arweave (bulk upload w/ private key)
- [ ] Parallelize retrieval (fast enough to scrape ~10K collection in <5m with local IPFS node + erigon, but can be faster with hosted nodes)
