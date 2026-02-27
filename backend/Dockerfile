# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Install system dependencies
# ffmpeg is required for yt-dlp to merge video/audio and handle post-processing
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container at /app
COPY requirements.txt .

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the backend code into the container
# We exclude venv and temp_downloads via .dockerignore
COPY . .

# Ensure temp_downloads directory exists
RUN mkdir -p temp_downloads

# Expose the port the app runs on
EXPOSE 8000

# Command to run the application
CMD ["python", "main.py"]
