export const AUTH_CONSTANTS = {
  JWT_SECRET: process.env.JWT_SECRET || 'bistech-ems-super-secret-key-32-bytes-minimum!',
  JWT_EXPIRES_IN: '15m',
  REFRESH_TOKEN_DAYS: 7,
  ABSOLUTE_SESSION_DAYS: 30,
  COOKIE_ACCESS_NAME: 'ems_access',
  COOKIE_REFRESH_NAME: 'ems_refresh',
  COOKIE_RESET_NAME: 'ems_reset',
  COOKIE_ACCESS_MAX_AGE_MS: 15 * 60 * 1000, // 15 mins
  COOKIE_REFRESH_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
  COOKIE_RESET_MAX_AGE_MS: 15 * 60 * 1000, // 15 mins
  MAX_FAILED_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION_MS: 15 * 60 * 1000, // 15 mins
  OTP_TTL_MS: 10 * 60 * 1000, // 10 mins
  OTP_MAX_ATTEMPTS: 5,
  OTP_COOLDOWN_MS: 60 * 1000, // 60 secs
  RESET_TOKEN_TTL_MS: 15 * 60 * 1000, // 15 mins
} as const;
