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
    {
      name: 'almaren-chat-worker',
      script: 'worker/agent-runtime.mjs',
      cwd: __dirname,
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      restart_delay: 2000,
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: process.env.DATABASE_URL || 'file:./data/dev.db',
        AGENT_WORKER_POLL_MS: process.env.AGENT_WORKER_POLL_MS || 1200,
        AGENT_MODEL_TIMEOUT_MS: process.env.AGENT_MODEL_TIMEOUT_MS || 180000,
      },
    },
  ],
};
