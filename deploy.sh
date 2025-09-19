#!/bin/bash

# Production deployment script for Bithumb Dashboard
# This script should be run on the production server (GCP instance)

set -e

echo "🚀 Starting deployment process..."

# Check if running as root or with sudo
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root or with sudo"
   exit 1
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Deployment configuration
DEPLOY_DIR="/var/www/bithumb-dashboard"
BACKUP_DIR="/var/backups/bithumb-dashboard"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

echo -e "${YELLOW}📦 Step 1: Creating backup...${NC}"
if [ -d "$DEPLOY_DIR" ]; then
    mkdir -p "$BACKUP_DIR"
    tar -czf "$BACKUP_DIR/backup_$TIMESTAMP.tar.gz" "$DEPLOY_DIR" 2>/dev/null || true
    echo -e "${GREEN}✅ Backup created: $BACKUP_DIR/backup_$TIMESTAMP.tar.gz${NC}"
fi

echo -e "${YELLOW}📦 Step 2: Setting up deployment directory...${NC}"
mkdir -p "$DEPLOY_DIR"
cd "$DEPLOY_DIR"

echo -e "${YELLOW}📦 Step 3: Pulling latest code from Git...${NC}"
if [ -d ".git" ]; then
    git pull origin main
else
    echo -e "${RED}❌ Git repository not initialized. Please clone your repository first:${NC}"
    echo "git clone <your-repo-url> $DEPLOY_DIR"
    exit 1
fi

echo -e "${YELLOW}📦 Step 4: Installing dependencies...${NC}"
npm ci --production

echo -e "${YELLOW}📦 Step 5: Building React application...${NC}"
npm run build

echo -e "${YELLOW}📦 Step 6: Setting up environment variables...${NC}"
if [ ! -f ".env" ]; then
    echo -e "${RED}❌ .env file not found!${NC}"
    echo -e "${YELLOW}Creating .env file template...${NC}"
    cat > .env.template << 'EOF'
# Production Environment Variables
NODE_ENV=production
PORT=3001
HOST=0.0.0.0

# Bithumb API Credentials (Required)
BITHUMB_API_KEY=your_api_key_here
BITHUMB_API_SECRET=your_api_secret_here

# Security Settings
GENERATE_SOURCEMAP=false
INLINE_RUNTIME_CHUNK=false

# Optional: CORS Configuration
# ALLOWED_DOMAIN=https://yourdomain.com
EOF
    echo -e "${GREEN}✅ Created .env.template${NC}"
    echo -e "${RED}Please create .env file with your actual API keys before continuing!${NC}"
    exit 1
fi

echo -e "${YELLOW}📦 Step 7: Setting correct permissions...${NC}"
chown -R www-data:www-data "$DEPLOY_DIR"
chmod 600 .env

echo -e "${YELLOW}📦 Step 8: Starting application with PM2...${NC}"
pm2 stop ecosystem.config.js 2>/dev/null || true
pm2 delete ecosystem.config.js 2>/dev/null || true
pm2 start ecosystem.config.js --env production
pm2 save

echo -e "${YELLOW}📦 Step 9: Setting up PM2 startup...${NC}"
pm2 startup systemd -u www-data --hp /home/www-data
pm2 save

echo -e "${YELLOW}📦 Step 10: Configuring nginx (if needed)...${NC}"
if [ -f "/etc/nginx/sites-available/bithumb-dashboard" ]; then
    echo -e "${GREEN}✅ Nginx configuration already exists${NC}"
else
    cat > /etc/nginx/sites-available/bithumb-dashboard << 'EOF'
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE support
        proxy_set_header Cache-Control 'no-cache';
        proxy_set_header X-Accel-Buffering 'no';
        proxy_read_timeout 86400;
    }
}
EOF
    ln -s /etc/nginx/sites-available/bithumb-dashboard /etc/nginx/sites-enabled/
    echo -e "${YELLOW}Please update the server_name in /etc/nginx/sites-available/bithumb-dashboard${NC}"
fi

echo -e "${YELLOW}📦 Step 11: Testing configuration...${NC}"
nginx -t
systemctl reload nginx

echo -e "${GREEN}🎉 Deployment complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Ensure your .env file contains the correct API keys"
echo "2. Update nginx configuration with your domain name"
echo "3. Set up SSL certificate with certbot"
echo "4. Monitor the application with: pm2 monit"
echo ""
echo "Useful commands:"
echo "- View logs: pm2 logs"
echo "- Check status: pm2 status"
echo "- Restart app: pm2 restart ecosystem.config.js"
echo "- Stop app: pm2 stop ecosystem.config.js"