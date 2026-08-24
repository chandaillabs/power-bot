#!/usr/bin/env bash
# Exit on error
set -o errexit

npm install

# Store/pull Puppeteer cache with build cache
PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer
mkdir -p $PUPPETEER_CACHE_DIR

# Install Chrome for Puppeteer
npx puppeteer browsers install chrome
