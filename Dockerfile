# Backend Dockerfile - Multi-stage build for optimized production image

# Stage 1: Build stage
FROM node:20-alpine AS builder

# Install dependencies for native modules and Python
RUN apk add --no-cache python3 py3-pip make g++

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci --legacy-peer-deps

# Copy source code
COPY src ./src
COPY scripts ./scripts
COPY prisma ./prisma

# Install Python dependencies for knowledge graph parser
RUN pip3 install --no-cache-dir --break-system-packages openpyxl pandas

# Generate Prisma Client (use local version from package.json)
RUN npm exec prisma generate

# Build TypeScript (skip for now - will use ts-node)
# RUN npm run build

# Stage 2: Production stage
FROM node:20-alpine AS production

# Install dependencies for native modules, Python, OpenSSL for Prisma, and ffmpeg for audio conversion
RUN apk add --no-cache python3 py3-pip openssl ffmpeg

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including ts-node for runtime)
RUN npm ci --legacy-peer-deps && npm cache clean --force

# Copy Python dependencies installation
RUN pip3 install --no-cache-dir --break-system-packages openpyxl pandas edge-tts

# Copy prisma schema
COPY prisma ./prisma

# Generate Prisma Client (use local version from package.json)
RUN npm exec prisma generate

# Copy source code (using ts-node instead of built dist)
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./

# Copy scripts (needed for database operations)
COPY scripts ./scripts

# Copy reference dataset (generated CSVs used by reviewer portal)
COPY reference-dataset ./reference-dataset

# Copy test config + fixtures so `npx jest` runs in this image without a
# manual `docker cp` per session (STATUS.md "Known landmines" -- hit
# repeatedly). jest/@types/jest/ts-jest are already installed above (this
# stage's `npm ci` keeps devDependencies for ts-node at runtime), so these
# two are the only missing pieces.
COPY jest.config.js ./
COPY tests ./tests

# Create uploads directory
RUN mkdir -p /app/uploads /app/logs

# Expose port (should match PORT in .env)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application (using ts-node for now)
CMD ["npm", "start"]
