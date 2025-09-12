# Pin to a slim Python image for smaller size and reproducibility
FROM python:3.12-slim

# Set environment variables for non-interactive installs and smaller pip footprint
ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# Install only the minimal runtime dependencies for headless Google Chrome
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    gnupg \
    curl \
    libglib2.0-0 \
    libnss3 \
    libxss1 \
    libxtst6 \
    libdbus-1-3 \
    libatk-bridge2.0-0 \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Add Google Chrome's official repository and key
RUN mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg && \
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list

# Install Google Chrome Stable and clean apt metadata in the same layer
RUN apt-get update && apt-get install -y --no-install-recommends google-chrome-stable && \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/*

# Set the working directory inside the container.
WORKDIR /app

# Install only Python dependencies first for better layer caching
COPY requirements.txt .
RUN python -m pip install -r requirements.txt

# Copy the rest of the application code into the container
COPY . .

# Entrypoint runs the service; Chrome runs headless so Xvfb is not required
CMD ["python", "./subpaperflux.py", "/config"]
