FROM oven/bun:1

WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy application source
COPY index.ts ./
COPY auth/ ./auth/

# Expose the service port
EXPOSE 3040

# Start the service
CMD ["bun", "index.ts"]
