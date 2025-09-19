# Bithumb Dashboard - Production Deployment Guide

## 📋 Prerequisites

- GCP instance (34.44.60.202) with SSH access
- Node.js 18+ installed on the server
- PM2 installed globally (`npm install -g pm2`)
- Nginx installed (optional but recommended for reverse proxy)
- Git repository set up

## 🔐 Environment Variables Setup

### Step 1: Prepare Environment Variables

Your production server needs the following environment variables:

```bash
# Required Variables
NODE_ENV=production
PORT=3001
HOST=0.0.0.0
BITHUMB_API_KEY=your_api_key_here
BITHUMB_API_SECRET=your_api_secret_here

# Optional Security Settings
GENERATE_SOURCEMAP=false
INLINE_RUNTIME_CHUNK=false
```

### Step 2: SSH into Your GCP Instance

```bash
ssh user@34.44.60.202
```

### Step 3: Set Up the Application Directory

```bash
# Create application directory
sudo mkdir -p /var/www/bithumb-dashboard

# Clone your repository
cd /var/www
sudo git clone <your-repository-url> bithumb-dashboard

# Change to the app directory
cd bithumb-dashboard
```

### Step 4: Create Production .env File

```bash
# Create .env file with your actual API credentials
sudo nano .env
```

Add your environment variables:
```env
NODE_ENV=production
PORT=3001
HOST=0.0.0.0
BITHUMB_API_KEY=your_actual_api_key
BITHUMB_API_SECRET=your_actual_api_secret
GENERATE_SOURCEMAP=false
INLINE_RUNTIME_CHUNK=false
```

Secure the .env file:
```bash
sudo chmod 600 .env
sudo chown www-data:www-data .env
```

## 🚀 Deployment Steps

### Option 1: Automated Deployment

Use the provided deployment script:

```bash
# Make the deployment script executable
chmod +x deploy.sh

# Run the deployment script
sudo ./deploy.sh
```

### Option 2: Manual Deployment

#### 1. Install Dependencies
```bash
npm ci --production
```

#### 2. Build the React Application
```bash
npm run build
```

#### 3. Start with PM2
```bash
# Start the application
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Set up PM2 to start on system boot
pm2 startup systemd
```

## 🔧 Nginx Configuration (Recommended)

### 1. Create Nginx Configuration

```bash
sudo nano /etc/nginx/sites-available/bithumb-dashboard
```

Add this configuration:
```nginx
server {
    listen 80;
    server_name your-domain.com;  # Replace with your domain

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
```

### 2. Enable the Site
```bash
sudo ln -s /etc/nginx/sites-available/bithumb-dashboard /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 🔒 SSL Certificate Setup (HTTPS)

For production, you should set up HTTPS:

```bash
# Install Certbot
sudo apt-get update
sudo apt-get install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal test
sudo certbot renew --dry-run
```

## 📊 Monitoring and Management

### PM2 Commands

```bash
# Check application status
pm2 status

# View logs
pm2 logs bithumb-dashboard

# Monitor in real-time
pm2 monit

# Restart application
pm2 restart bithumb-dashboard

# Stop application
pm2 stop bithumb-dashboard

# Delete from PM2
pm2 delete bithumb-dashboard
```

### Log Files

Logs are stored in:
- Application logs: `/var/www/bithumb-dashboard/logs/`
- PM2 logs: `~/.pm2/logs/`
- Nginx logs: `/var/log/nginx/`

## 🔄 Updating the Application

To update the application with new code:

```bash
cd /var/www/bithumb-dashboard

# Pull latest changes
git pull origin main

# Install any new dependencies
npm ci --production

# Build the React app
npm run build

# Reload the application
pm2 reload ecosystem.config.js --env production
```

## 🐛 Troubleshooting

### Check if the server is running
```bash
pm2 status
curl http://localhost:3001/health
```

### Check logs for errors
```bash
pm2 logs --lines 100
```

### Check system resources
```bash
pm2 monit
free -h
df -h
```

### Common Issues

1. **Port already in use**
   ```bash
   # Find process using port 3001
   sudo lsof -i :3001
   # Kill the process
   sudo kill -9 <PID>
   ```

2. **Permission issues**
   ```bash
   sudo chown -R www-data:www-data /var/www/bithumb-dashboard
   ```

3. **Memory issues**
   - Check PM2 max_memory_restart in ecosystem.config.js
   - Adjust Node.js memory: `--max-old-space-size=2048`

## 🔐 Security Checklist

- ✅ Environment variables stored in .env file (not in code)
- ✅ .env file has restricted permissions (600)
- ✅ HTTPS enabled with SSL certificate
- ✅ Firewall configured (only allow ports 80, 443, 22)
- ✅ Regular security updates: `sudo apt-get update && sudo apt-get upgrade`
- ✅ PM2 running with limited user permissions
- ✅ Nginx rate limiting configured
- ✅ Application logs monitored regularly

## 📝 Quick Start Commands Summary

```bash
# SSH to server
ssh user@34.44.60.202

# Navigate to app directory
cd /var/www/bithumb-dashboard

# Check status
pm2 status

# View logs
pm2 logs

# Restart application
pm2 restart ecosystem.config.js --env production

# Update application
git pull && npm ci --production && npm run build && pm2 reload ecosystem.config.js --env production
```

## 🆘 Support

If you encounter issues:
1. Check the logs first: `pm2 logs`
2. Verify environment variables are set correctly
3. Ensure all dependencies are installed
4. Check network connectivity to Bithumb API
5. Verify file permissions

Remember to never commit your .env file to version control!