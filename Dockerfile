# Stage 1: The Build Environment
# Use a base image that already has Chrome and a WebDriver
FROM python:3.11-slim AS builder

# Set the working directory inside the container
WORKDIR /app

# Install system dependencies needed for the application
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    unzip \
    libnss3 \
    libxss1 \
    libappindicator3-1 \
    libsecret-1-0 \
    libgconf-2-4 \
    libasound2 \
    libcurl4 \
    libfontconfig1 \
    libgtk-3-0 \
    libnotify4 \
    libxslt1-dev \
    libxml2-dev \
    zlib1g \
    && rm -rf /var/lib/apt/lists/*

# Install Chrome and ChromeDriver
RUN wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && \
    apt-get install -y ./google-chrome-stable_current_amd64.deb && \
    rm google-chrome-stable_current_amd64.deb

# Install Python dependencies from a requirements.txt file
COPY requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Stage 2: The Final, Small Image
FROM python:3.11-slim

# Set environment variables for running a non-root user
ENV HOME=/app

# Create a non-root user and switch to it
RUN addgroup --system appgroup && \
    adduser --system --ingroup appgroup --disabled-password --shell /bin/bash appuser && \
    chown -R appuser:appgroup /app

USER appuser

# Copy the Python script and requirements from the builder stage
WORKDIR /app
COPY --from=builder /usr/bin/google-chrome /usr/bin/google-chrome
COPY --from=builder /usr/lib/chromium/chromedriver /usr/bin/chromedriver
COPY --from=builder /usr/local/lib/python3.11/dist-packages /usr/local/lib/python3.11/dist-packages
COPY rss_feed_bridge.py .

# Set the entrypoint to run the script directly
CMD ["python", "./rss_feed_bridge.py", "/config"]