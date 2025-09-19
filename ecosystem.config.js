module.exports = {
  apps: [
    {
      name: 'bithumb-dashboard',
      script: './server.js',
      instances: 'max',
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '1G',

      // Environment variables
      env: {
        NODE_ENV: 'development',
        PORT: 3001,
        HOST: '127.0.0.1'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
        HOST: '0.0.0.0',
        // API keys will be loaded from .env file
      },

      // Logging
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true,

      // Advanced features
      kill_timeout: 5000,
      listen_timeout: 10000,

      // Monitoring
      min_uptime: '10s',
      max_restarts: 10,

      // Auto restart on file changes (disabled in production)
      autorestart: true,

      // Cron restart (optional - restart every day at 3 AM)
      // cron_restart: '0 3 * * *',

      // Node arguments
      node_args: '--max-old-space-size=1024',

      // Merge logs
      merge_logs: true,

      // Log date format
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Error handling
      post_update: ['npm install', 'echo "App updated and dependencies installed"'],

      // Environment specific configurations
      env_production: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3001,
        HOST: '0.0.0.0',
        instances: 2,
        exec_mode: 'cluster'
      }
    }
  ],

  // Deployment configuration
  deploy: {
    production: {
      user: 'www-data',
      host: '34.44.60.202',
      ref: 'origin/main',
      repo: 'git@github.com:yourusername/bithumb-dashboard.git',
      path: '/var/www/bithumb-dashboard',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
      'pre-setup': '',
      ssh_options: 'StrictHostKeyChecking=no'
    }
  }
};