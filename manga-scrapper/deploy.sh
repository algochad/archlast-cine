#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

# Stop and remove running containers
echo "==> Stopping existing containers..."
docker compose down

# Rebuild images and start containers in detached mode
echo "==> Rebuilding and starting new containers..."
docker compose up -d --build

# Display current container status
echo "==> Current container status:"
docker compose ps