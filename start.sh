#!/bin/bash

# Start cron in the foreground.
# This is crucial for making cron logs visible in the Docker container's output.
cron -f