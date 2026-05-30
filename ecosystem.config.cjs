module.exports = {
  apps: [
    {
      name: 'almaren-chat',
      script: 'server.mjs',
      cwd: __dirname,
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 8001,
        HOSTNAME: '0.0.0.0',
        DATABASE_URL: process.env.DATABASE_URL || 'file:./data/dev.db',
      },
    },
  ],
};
