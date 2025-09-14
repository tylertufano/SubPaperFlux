# Multi-stage Dockerfile for Next.js (web UI)

FROM node:20-alpine AS deps
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Build stage
FROM node:20-alpine AS build
WORKDIR /app
ENV NODE_ENV=production
# Allow overriding API base at build time for Next.js static env inlining
ARG NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public \
    && ls -la || true
RUN npm run build

# Runtime stage
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Optionally expose at runtime too (not required for Next public envs, but harmless)
ARG NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE}

# Copy only what we need to run `next start`
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/next.config.js ./next.config.js

EXPOSE 3000
CMD ["npm", "run", "start"]
