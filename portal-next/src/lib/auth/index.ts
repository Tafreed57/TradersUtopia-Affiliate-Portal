/**
 * Auth Module Exports
 */

export {
  hashPassword,
  verifyPassword,
  hashPasswordLegacy,
  verifyPasswordLegacy,
  verifyPasswordUnified,
  generateLegacySalt,
  isLegacyHash,
  rehashIfLegacy,
} from './password';

export {
  createSessionToken,
  verifySessionToken,
  generateLegacySessionToken,
  buildSessionData,
  isSessionExpired,
  extractTokenFromRequest,
  getSessionExpiry,
  type SessionPayload,
  type SessionData,
} from './session';
