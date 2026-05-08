FROM oven/bun:1

WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy application source (auth/ comes from persistent disk on Render)
COPY index.ts ./

# Expose the service port (Render overrides with PORT env var)
EXPOSE 3040

# Start the service
CMD ["bun", "index.ts"]
