# Use an official Python runtime as a parent image
FROM python:3-slim

# Set environment variables to non-interactive (to skip any interactive post-install configuration steps)
ENV DEBIAN_FRONTEND=noninteractive

# Update the package list and install necessary packages
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    unzip \
    cron

# Add Google Chrome to the repositories
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list

# Install Google Chrome
RUN apt-get update && apt-get install -y google-chrome-stable

# Install ChromeDriver
RUN CHROME_VERSION=$(google-chrome --version | cut -d ' ' -f 3 | cut -d '.' -f 1) \
    && CHROMEDRIVER_VERSION=$(curl -s "https://chromedriver.storage.googleapis.com/LATEST_RELEASE_$CHROME_VERSION") \
    && wget --no-verbose -O chromedriver_linux64.zip https://chromedriver.storage.googleapis.com/$CHROMEDRIVER_VERSION/chromedriver_linux64.zip \
    && unzip chromedriver_linux64.zip \
    && rm chromedriver_linux64.zip \
    && mv chromedriver /usr/bin/chromedriver \
    && chmod +x /usr/bin/chromedriver

# Install any needed packages (none needed in this case)
RUN pip install --no-cache-dir -r selenium requests argparse configparser webdriver-manager

# Clean up to reduce image size
RUN apt-get purge --auto-remove -y wget gnupg unzip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Reset the frontend variable (safety)
ENV DEBIAN_FRONTEND=dialog

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
