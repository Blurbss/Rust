require('dotenv').config();

function required(name, fallback) {
  const val = process.env[name] ?? fallback;
  if (val === undefined || val === '') {
    console.warn(`[config] Warning: ${name} is not set`);
  }
  return val;
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  webhookSecret: required('WEBHOOK_SECRET'),

  rustApi: {
    baseUrl: required('RUST_API_BASE_URL'),
    apiKey: required('RUST_API_KEY')
  },

  rustPlus: {
    serverIp: process.env.RUSTPLUS_SERVER_IP || '',
    serverPort: process.env.RUSTPLUS_SERVER_PORT || '',
    playerId: process.env.RUSTPLUS_PLAYER_ID || '',
    playerToken: process.env.RUSTPLUS_PLAYER_TOKEN || ''
  },

  azure: {
    key: process.env.AZURE_KEY || '',
    region: process.env.AZURE_REGION || 'centralus'
  }
};
