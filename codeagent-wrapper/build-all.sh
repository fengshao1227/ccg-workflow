#!/bin/bash
set -e

echo "Building codeagent-wrapper for all platforms..."

# macOS
echo "Building for macOS (amd64)..."
GOOS=darwin GOARCH=amd64 go build -o ../bin/codeagent-wrapper-darwin-amd64 .

echo "Building for macOS (arm64)..."
GOOS=darwin GOARCH=arm64 go build -o ../bin/codeagent-wrapper-darwin-arm64 .

# Linux
echo "Building for Linux (amd64)..."
GOOS=linux GOARCH=amd64 go build -o ../bin/codeagent-wrapper-linux-amd64 .

echo "Building for Linux (arm64)..."
GOOS=linux GOARCH=arm64 go build -o ../bin/codeagent-wrapper-linux-arm64 .

# Windows
echo "Building for Windows (amd64)..."
GOOS=windows GOARCH=amd64 go build -o ../bin/codeagent-wrapper-windows-amd64.exe .

echo "Building for Windows (arm64)..."
GOOS=windows GOARCH=arm64 go build -o ../bin/codeagent-wrapper-windows-arm64.exe .

echo "All builds completed successfully!"
ls -lh ../bin/codeagent-wrapper-*
