# BuilderBot Dockerfile - Node.js/TypeScript
FROM node:20-alpine AS base

# Install dependencies for building
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
RUN \
  if [ -f package-lock.json ]; then npm ci; \
  else echo "Lockfile not found." && exit 1; \
  fi

# Build TypeScript
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set environment variables for build
ENV NODE_ENV=production

# Build TypeScript to JavaScript
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 builderbot

# Create logs directory first (as root)
RUN mkdir -p /app/logs

# Copy necessary files
COPY --from=builder --chown=builderbot:nodejs /app/dist ./dist
COPY --from=builder --chown=builderbot:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=builderbot:nodejs /app/package.json ./package.json

# Set permissions for logs directory and ensure /app is writable
# Give write permissions to /app so BuilderBot can create log files
RUN chown -R builderbot:nodejs /app/logs && \
    chmod -R 755 /app/logs && \
    chown -R builderbot:nodejs /app && \
    chmod -R 775 /app

USER builderbot

EXPOSE 3008

ENV PORT=3008
ENV NODE_ENV=production

# Set log directory environment variable if BuilderBot supports it
ENV LOG_DIR=/app/logs

CMD ["node", "dist/index.js"]

