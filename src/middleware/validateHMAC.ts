import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import logger from '../config/logger';

/**
 * Validates Motive webhook HMAC signature
 * 
 * Motive sends signature in header: X-Motive-Signature
 * Format: sha256=<hash>
 */
export function validateMotiveHMAC(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const signature = req.headers['x-motive-signature'] as string;
  console.log('Validating HMAC signature:', req.body, 'header:', req.headers);
  console.log("SNS Message:", req.body);
  console.log("Actual Motive Payload:", JSON.parse(req.body.Payload));

  // For development: Allow skipping validation if no secret set
  if (!process.env.MOTIVE_WEBHOOK_SECRET) {
    logger.warn('⚠️  MOTIVE_WEBHOOK_SECRET not set - skipping HMAC validation');
    return next();
  }

  if (!signature) {
    logger.error('❌ Webhook rejected: Missing X-Motive-Signature header');
    return res.status(401).json({
      success: false,
      error: 'Missing signature',
    });
  }

  try {
    // Get raw body (we need the exact bytes Motive sent)
    const rawBody = JSON.stringify(req.body);

    // Compute expected signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.MOTIVE_WEBHOOK_SECRET!)
      .update(rawBody)
      .digest('hex');

    // Extract hash from signature (format: "sha256=<hash>")
    const providedHash = signature.startsWith('sha256=')
      ? signature.substring(7)
      : signature;

    // Constant-time comparison to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(providedHash)
    );

    if (!isValid) {
      logger.error('❌ Webhook rejected: Invalid HMAC signature');
      return res.status(401).json({
        success: false,
        error: 'Invalid signature',
      });
    }

    logger.info('✅ Webhook HMAC signature validated');
    next();
  } catch (error) {
    logger.error('❌ HMAC validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Signature validation failed',
    });
  }
}