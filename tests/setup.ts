process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-vitest'
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pictoria-test-placeholder'
process.env.CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173'
process.env.TRUST_PROXY_HOPS = '0'

// Tests must never write to the real R2 bucket, even if a developer .env has live credentials.
process.env.CLOUDFLARE_ACCOUNT_ID = 'placeholder'
process.env.R2_ACCESS_KEY_ID = 'placeholder'
process.env.R2_SECRET_ACCESS_KEY = 'placeholder'
process.env.R2_PUBLIC_URL = 'https://pub-placeholder.r2.dev'
