export const AUTH_CONSTANTS = {
  JWT_SECRET: process.env.JWT_SECRET || 'bistech-ems-super-secret-key-32-bytes-minimum!',
  JWT_EXPIRES_IN: '15m',
  REFRESH_TOKEN_DAYS: 7,
  ABSOLUTE_SESSION_DAYS: 30,
  COOKIE_ACCESS_NAME: 'ems_access',
  COOKIE_REFRESH_NAME: 'ems_refresh',
  COOKIE_ACCESS_MAX_AGE_MS: 15 * 60 * 1000, // 15 mins
  COOKIE_REFRESH_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
  MAX_FAILED_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION_MS: 15 * 60 * 1000, // 15 mins
} as const;
