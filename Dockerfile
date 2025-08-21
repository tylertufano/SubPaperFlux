# Use an official Python runtime as a parent image
FROM python:3-slim

# Set environment variables to non-interactive (to skip any interactive post-install configuration steps)
ENV DEBIAN_FRONTEND=noninteractive

# Update the package list and install necessary packages
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    gnupg2 \
    unzip \
    xvfb \
    cron

# Add Google Chrome to the repositories
RUN echo 'deb [signed-by=/usr/share/keyrings/google-linux-signing-key.gpg] http://dl.google.com/linux/chrome/deb/ stable main' > /etc/apt/sources.list.d/google-chrome.list \
    && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --yes --dearmor -o /usr/share/keyrings/google-linux-signing-key.gpg

# Install Google Chrome
RUN apt-get update && apt-get install -y google-chrome-stable --no-install-recommends

# Install ChromeDriver
RUN wget -O /tmp/chromedriver.zip https://chromedriver.storage.googleapis.com/$(wget -qO- chromedriver.storage.googleapis.com/LATEST_RELEASE)/chromedriver_linux64.zip \
    && unzip /tmp/chromedriver.zip chromedriver -d /usr/local/bin/ \
    && rm /tmp/chromedriver.zip

# Clean up to reduce image size
RUN apt-get purge --auto-remove -y wget gnupg2 unzip xvfb ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install any needed packages (none needed in this case)
RUN pip install --no-cache-dir -r requirements.txt

# Reset the frontend variable (safety)
ENV DEBIAN_FRONTEND=dialog

# Set display port to avoid crash
ENV DISPLAY=:99

# Set the working directory
WORKDIR /app

# Copy the current directory contents into the container at /usr/src/app
COPY . .

# Copy the cron job file into the cron.d directory
COPY periodic-docker-input /etc/cron.d/periodic-docker-input

# Give execution rights on the cron job
RUN chmod 0644 /etc/cron.d/periodic-docker-input

# Apply the cron job
# RUN crontab /etc/cron.d/periodic-docker-input

# Create the log file to be able to run tail
RUN touch /var/log/cron.log

# Run the command on container startup
CMD cron && tail -f /var/log/cron.log
