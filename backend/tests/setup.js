'use strict';

// Force mock LLM so tests never hit real Anthropic API
process.env.USE_MOCK_LLM = 'true';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_EXPIRY = '1h';
process.env.NODE_ENV = 'test';
process.env.PORT = '3099';
process.env.LOG_LEVEL = 'error'; // suppress logs during tests
process.env.UPLOAD_DIR = require('os').tmpdir();
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/trade_doc_test';
process.env.REDIS_URL = 'redis://localhost:6379';
