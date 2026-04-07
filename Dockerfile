FROM node:20-slim

WORKDIR /app

# System deps: ffmpeg for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install ALL dependencies (including devDeps for TypeScript build)
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Remove devDependencies to keep image lean
RUN npm prune --omit=dev

# Expose health check port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/ || exit 1

# Start the production build
CMD ["npm", "start"]
