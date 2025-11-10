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

# Copy necessary files
COPY --from=builder --chown=builderbot:nodejs /app/dist ./dist
COPY --from=builder --chown=builderbot:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=builderbot:nodejs /app/package.json ./package.json

USER builderbot

EXPOSE 3008

ENV PORT=3008

CMD ["node", "dist/index.js"]

