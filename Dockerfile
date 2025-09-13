# Multi-stage build for smaller runtime image

# --- Stage: deps (install Python deps into a venv) ---
FROM python:3.12-slim AS deps

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app
COPY requirements.txt requirements.api.txt ./
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-compile -r requirements.txt -r requirements.api.txt

# --- Stage: runtime (install Chrome + minimal libs, copy venv + app) ---
FROM python:3.12-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

# Install minimal Chrome runtime deps, add Google repo, install Chrome,
# then purge tooling (curl, gnupg) and clean apt caches in the same layer
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
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
 && mkdir -p /etc/apt/keyrings \
 && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg \
 && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends google-chrome-stable \
 && apt-get purge -y gnupg curl \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/*

WORKDIR /app

# Copy Python dependencies and make venv default
COPY --from=deps /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy application source
COPY . .

# Default to running the API; Chrome runs headless so Xvfb is not required.
# For worker, override the command in docker-compose to `python -m app.worker`.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
