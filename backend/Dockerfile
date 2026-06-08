# ---- Base Node image ----
FROM node:22.19.0-alpine AS builder

# Create app directory
WORKDIR /usr/src/app

# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Install app dependencies
RUN npm install

# Bundle app source
COPY . .

# Build the app
RUN npm run build

# ---- Production image ----
FROM node:22.19.0-alpine

WORKDIR /usr/src/app

# Copy the environment file
# COPY production.env .env

COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy built assets from builder
COPY --from=builder /usr/src/app/dist ./dist

# Expose the listening port
EXPOSE 3000

# Start the server using the production build
CMD [ "node", "dist/main.js" ]
