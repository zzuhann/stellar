#!/bin/bash
set -e

echo "🔍 Checking TypeScript installation..."
npx tsc --version

echo "🧹 Cleaning previous build..."
rm -rf dist

echo "📦 Building TypeScript..."
npx tsc

echo "✅ Build completed successfully!"
ls -la dist/