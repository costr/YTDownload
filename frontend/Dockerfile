# Stage 1: Build the React application
FROM node:20-slim AS build

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the application
# We provide VITE_API_BASE at build time if we want to bake it in,
# but for Docker, it's often easier to set it at runtime if using a node-based server.
# However, for Nginx, it's baked into the static files.
# For simplicity, we'll assume the default or provide it in docker-compose build args.
ARG VITE_API_BASE
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# Stage 2: Serve the application using Nginx
FROM nginx:alpine

# Copy the build output from the build stage to the Nginx html directory
COPY --from=build /app/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
