# Stage 1: The Build Environment
# Use a full-featured Debian base for the build process
FROM python:3.13-slim AS builder

# Set environment variables for non-interactive installations
ENV DEBIAN_FRONTEND=noninteractive

# Install necessary system packages for Google Chrome and other tools
# xvfb is included for headless browser support
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    gnupg \
    wget \
    curl \
    unzip \
    libglib2.0-0 \
    libnss3 \
    libxss1 \
    libxtst6 \
    libdbus-1-3 \
    libatk-bridge2.0-0 \
    fontconfig \
    fonts-liberation \
    xvfb \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Add Google Chrome's official repository and key
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg && \
    sh -c 'echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list'

# Update and install Google Chrome Stable
RUN apt-get update && \
    apt-get install -y google-chrome-stable \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Set the working directory for the build stage
WORKDIR /app

# Copy requirements file and install Python dependencies
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy all application code to the container
COPY . .

# Stage 2: The Final, Lean Runtime Environment
# Use a minimal base image for the final product
FROM python:3.13-slim

# Set environment variables for non-interactive installations
ENV DEBIAN_FRONTEND=noninteractive

# Install only the runtime dependencies for Google Chrome and the application
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libnss3 \
    libxss1 \
    libxtst6 \
    libdbus-1-3 \
    libatk-bridge2.0-0 \
    fontconfig \
    fonts-liberation \
    xvfb \
    google-chrome-stable \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Set display port to avoid crash
ENV DISPLAY=:99

# Set the working directory
WORKDIR /app

# Copy only the necessary files from the builder stage
# This includes the Python application code and the installed dependencies
COPY --from=builder /app /app

# Create a non-root user and set permissions for security
RUN addgroup --system bridge && \
    adduser --system --ingroup bridge --disabled-password --shell /bin/bash bridge && \
    chown -R bridge:bridge /app

# Switch to the non-root user
USER bridge

# Set the entry point for the application
CMD ["python", "./rss_feed_bridge.py", "/config"]