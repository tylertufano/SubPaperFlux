# Use an official Python runtime as a parent image
FROM python:3.9-slim

# Install cron
RUN apt-get update && apt-get install -y cron

# Set the working directory
WORKDIR /usr/src/app

# Copy the current directory contents into the container at /usr/src/app
COPY . .

# Install any needed packages (none needed in this case)
RUN pip install --no-cache-dir -r requirements.txt

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
