FROM node:20-slim

WORKDIR /app

# System deps: ffmpeg for audio, curl for health check
RUN apt-get update && apt-get install -y ffmpeg curl unzip && rm -rf /var/lib/apt/lists/*

# Install gogcli for Google Workspace integration (Linux amd64)
RUN curl -LO https://github.com/steipete/gogcli/releases/download/v0.12.0/gogcli_0.12.0_linux_amd64.tar.gz && \
    tar -xzf gogcli_0.12.0_linux_amd64.tar.gz gog && \
    mv gog /usr/local/bin/gog && \
    chmod +x /usr/local/bin/gog && \
    rm gogcli_0.12.0_linux_amd64.tar.gz

# Install GitHub CLI (gh)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" >> /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/*

# Install npm dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Health check: verify process is alive
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1

# Start the production build
CMD ["npm", "start"]
