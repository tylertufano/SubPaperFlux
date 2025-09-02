# Stage 1: The Build Environment
FROM python:3.13-slim AS builder

# Set environment variables for non-interactive installations
ENV DEBIAN_FRONTEND=noninteractive

# Install core dependencies for Google Chrome and utilities
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    wget \
    gnupg \
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

# Download Google Chrome .deb file directly and install
RUN wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && \
    dpkg -i google-chrome-stable_current_amd64.deb; apt-get -y install -f && \
    rm google-chrome-stable_current_amd64.deb

# Set the working directory for the build stage
WORKDIR /app

# Copy requirements file
COPY requirements.txt .

# Create a virtual environment and install Python dependencies into it
RUN python3 -m venv /app/venv && \
    . /app/venv/bin/activate && \
    pip install --no-cache-dir -r requirements.txt

# Copy all application code to the container
COPY . .

# Stage 2: The Final, Lean Runtime Environment
FROM python:3.13-slim

# Set environment variables for non-interactive installations
ENV DEBIAN_FRONTEND=noninteractive

# Install only the runtime dependencies for Google Chrome and the application
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    wget \
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

# Download Google Chrome .deb file directly and install
RUN wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && \
    dpkg -i google-chrome-stable_current_amd64.deb; apt-get -y install -f && \
    rm google-chrome-stable_current_amd64.deb

# Set display port to avoid crash
ENV DISPLAY=:99

# Set the working directory
WORKDIR /app

# Copy the application code and the virtual environment from the builder stage
COPY --from=builder /app /app

# Create a non-root user and set permissions for security
RUN addgroup --system bridge && \
    adduser --system --ingroup bridge --disabled-password --shell /bin/bash bridge && \
    chown -R bridge:bridge /app

# Make the /app directory writable by all users to fix permission issues with mounted volumes
RUN chmod -R a+w /app

# Explicitly set the home directory for the non-root user
ENV HOME=/app

# Switch to the non-root user
USER bridge

# Set the entry point for the application
CMD ["/app/venv/bin/python3", "./rss_feed_bridge.py", "/config"]