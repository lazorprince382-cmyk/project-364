module.exports = {
  apps: [
    {
      name: 'ocean-school',
      cwd: __dirname + '/..',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: (() => {
        require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
        return {
          NODE_ENV: 'production',
          PORT: process.env.PORT || 3001,
          DATABASE_URL: process.env.DATABASE_URL,
          STAFF_AUTH_SECRET: process.env.STAFF_AUTH_SECRET,
        };
      })(),
    },
  ],
};
