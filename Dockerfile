# Use a minimal Debian-based image for a lean environment.
FROM debian:stable-slim

# Set environment variables for non-interactive installations.
ENV DEBIAN_FRONTEND=noninteractive

# Install necessary system packages.
# `ca-certificates` is needed for HTTPS.
# `gnupg` is for adding external GPG keys.
# `wget` is for downloading the Chrome repository key.
# `curl` is used by the webdriver_manager.
# `unzip` is needed for the webdriver_manager to extract the driver.
# `libglib2.0-0`, `libnss3`, `libxss1`, `libxtst6`, `libdbus-1-3`, `libatk-bridge2.0-0` are essential dependencies for running headless Chrome.
# `fontconfig`, `fonts-liberation` are for font rendering, which can be required even in headless mode for some page layouts.
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
# This ensures we get the official, stable version of Chrome.
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg && \
    sh -c 'echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list'

# Update and install Google Chrome Stable.
# Use a specific version to ensure consistency, matching the ChromeDriver version that webdriver_manager will install.
RUN apt-get update && apt-get install -y google-chrome-stable && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Set the working directory inside the container.
WORKDIR /app

# Install Python and pip.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 \
    python3-pip && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy the requirements file and install Python dependencies first.
# This allows Docker to use the build cache for subsequent builds if requirements don't change.
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy the rest of the application code into the container.
COPY . .

# Set the entry point to execute the Python script.
ENTRYPOINT ["python3", "your_script_name.py"]