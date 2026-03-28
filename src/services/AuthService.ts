import crypto from 'crypto';

type DriverAuthTokenPayload = {
  sub: number;
  email: string;
  type: 'driver';
  iat: number;
  exp: number;
};

export default class AuthService {
  private static readonly iterations = 100000;
  private static readonly keyLength = 64;
  private static readonly digest = 'sha512';
  private static readonly tokenTtlSeconds = 60 * 60 * 24 * 7;

  private static getPasswordSecret() {
    return process.env.AUTH_PASSWORD_SECRET || process.env.AUTH_SECRET || 'nodi-driver-auth';
  }

  private static getTokenSecret() {
    return process.env.AUTH_TOKEN_SECRET || process.env.AUTH_SECRET || 'nodi-driver-token';
  }

  static hashPassword(password: string) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = crypto
      .pbkdf2Sync(
        password,
        `${salt}:${AuthService.getPasswordSecret()}`,
        AuthService.iterations,
        AuthService.keyLength,
        AuthService.digest
      )
      .toString('hex');

    return `${salt}:${derivedKey}`;
  }

  static verifyPassword(password: string, storedHash: string) {
    const [salt, expectedHash] = storedHash.split(':');
    if (!salt || !expectedHash) {
      return false;
    }

    const computedHash = crypto.pbkdf2Sync(
      password,
      `${salt}:${AuthService.getPasswordSecret()}`,
      AuthService.iterations,
      AuthService.keyLength,
      AuthService.digest
    );

    const expectedBuffer = Buffer.from(expectedHash, 'hex');
    if (expectedBuffer.length !== computedHash.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, computedHash);
  }

  static createDriverToken(driverId: number, email: string) {
    const now = Math.floor(Date.now() / 1000);
    const payload: DriverAuthTokenPayload = {
      sub: driverId,
      email,
      type: 'driver',
      iat: now,
      exp: now + AuthService.tokenTtlSeconds,
    };

    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', AuthService.getTokenSecret())
      .update(encodedPayload)
      .digest('base64url');

    return `${encodedPayload}.${signature}`;
  }
}
