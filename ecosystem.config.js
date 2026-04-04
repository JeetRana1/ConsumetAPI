module.exports = {
  apps: [{
    name: 'consumet-api',
    script: 'dist/main.js',
    cwd: process.env.HOME + '/ConsumetAPI',
    interpreter: 'node',
    cron_restart: '0 0 * * *',
    env: {
      PORT: 3000,
      NODE_ENV: 'production'
    },
    max_memory_restart: '850M',
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
