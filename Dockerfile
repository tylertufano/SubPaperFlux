# Use the official Python 3 slim image, which is based on Debian.
FROM python:3-slim

# Set environment variables for non-interactive installations.
ENV DEBIAN_FRONTEND=noninteractive

# Install necessary system packages for Google Chrome.
# `ca-certificates`, `gnupg`, `wget`, `curl`, `unzip` are general utilities.
# `libglib2.0-0`, `libnss3`, `libxss1`, `libxtst6`, `libdbus-1-3`, `libatk-bridge2.0-0` are core dependencies for headless Chrome.
# `fontconfig`, `fonts-liberation` are for font rendering.
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
    xvfb && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Add Google Chrome's official repository and key.
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg && \
    sh -c 'echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list'

# Update and install Google Chrome Stable.
RUN apt-get update && apt-get install -y google-chrome-stable && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Set display port to avoid crash
ENV DISPLAY=:99

# Set the working directory inside the container.
WORKDIR /app

# Copy the requirements file and install Python dependencies.
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy the rest of the application code into the container.
COPY . .

# Ensure the start script is executable
RUN chmod +x ./start.sh

# Set the entrypoint to run the script directly
CMD ["python", "./rss_feed_bridge.py", "/config"]