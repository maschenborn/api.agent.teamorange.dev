/**
 * JWT Authentication Middleware
 *
 * Validates Bearer tokens for API endpoints.
 * Email webhook uses separate signature verification (Resend).
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

export interface JwtPayload {
  sub: string; // User/client identifier
  iat: number; // Issued at
  exp: number; // Expiration
  iss: string; // Issuer
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

/**
 * JWT Authentication middleware
 * Requires valid Bearer token in Authorization header
 */
export function jwtAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  // Check if JWT is configured
  if (!config.jwtSecret) {
    logger.error('JWT_SECRET not configured - API authentication disabled');
    res.status(500).json({
      error: 'API authentication not configured',
      code: 'AUTH_NOT_CONFIGURED',
    });
    return;
  }

  // Extract token from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Missing or invalid Authorization header',
      code: 'AUTH_MISSING',
      hint: 'Use: Authorization: Bearer <token>',
    });
    return;
  }

  const token = authHeader.slice(7); // Remove 'Bearer ' prefix

  try {
    const decoded = jwt.verify(token, config.jwtSecret, {
      issuer: config.jwtIssuer,
    }) as JwtPayload;

    req.user = decoded;

    logger.debug({ sub: decoded.sub }, 'JWT authentication successful');
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        error: 'Token expired',
        code: 'AUTH_EXPIRED',
        expiredAt: error.expiredAt,
      });
      return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        error: 'Invalid token',
        code: 'AUTH_INVALID',
        message: error.message,
      });
      return;
    }

    logger.error({ error }, 'JWT verification failed');
    res.status(500).json({
      error: 'Authentication failed',
      code: 'AUTH_ERROR',
    });
  }
}

/**
 * Generate a new JWT token
 * Used by CLI tool or admin endpoint
 */
export function generateToken(subject: string, expiresIn?: string): string {
  if (!config.jwtSecret) {
    throw new Error('JWT_SECRET not configured');
  }

  return jwt.sign({ sub: subject }, config.jwtSecret, {
    issuer: config.jwtIssuer,
    expiresIn: (expiresIn || config.jwtExpiresIn) as jwt.SignOptions['expiresIn'],
  });
}
