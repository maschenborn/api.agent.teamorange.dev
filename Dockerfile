# ===========================================
# Claude Remote Agent - Webhook Server
# Deployment: Coolify
# ===========================================

FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies (include dev for TypeScript build)
COPY package*.json ./
RUN npm ci --include=dev

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ===========================================
# Production Image
# ===========================================
FROM node:20-alpine

WORKDIR /app

# Install Docker CLI (needed to spawn agent containers)
RUN apk add --no-cache docker-cli

# Create non-root user with docker group access
# GID 988 matches the host's docker group for socket access
RUN addgroup -g 988 -S docker && \
    addgroup -g 1001 -S agent && \
    adduser -S agent -u 1001 -G agent && \
    adduser agent docker

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

# Copy agent sandbox files (will be built separately)
COPY docker ./docker

# Create .claude directory for credentials
RUN mkdir -p /app/.claude && chown agent:agent /app/.claude

# Switch to non-root user
USER agent

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start server
CMD ["node", "dist/index.js"]
