import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import logger from './logger';

let firebaseInitialized = false;

// Initialize Firebase Admin
export function initializeFirebase() {
  if (firebaseInitialized) {
    return;
  }

  try {
    const serviceAccountPath =
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (serviceAccountPath) {
      const absolutePath = path.isAbsolute(serviceAccountPath)
        ? serviceAccountPath
        : path.resolve(process.cwd(), serviceAccountPath);

      if (fs.existsSync(absolutePath)) {
        const raw = fs.readFileSync(absolutePath, 'utf8');
        const serviceAccount = JSON.parse(raw);

        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });

        firebaseInitialized = true;
        logger.info(`✅ Firebase Admin SDK initialized (service account file: ${path.basename(absolutePath)})`);
        return;
      }

      logger.warn(`⚠️  FIREBASE_SERVICE_ACCOUNT_PATH not found at ${absolutePath}, trying env vars fallback`);
    }

    // Fallback to env var credentials
    if (
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_PRIVATE_KEY &&
      process.env.FIREBASE_CLIENT_EMAIL
    ) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
      });

      firebaseInitialized = true;
      logger.info('✅ Firebase Admin SDK initialized (env credentials)');
      return;
    }

    logger.warn('⚠️  Firebase not configured - push notifications will be mocked');
  } catch (error) {
    logger.error('❌ Firebase initialization failed:', error);
    logger.warn('⚠️  Push notifications will be mocked');
  }
}

// Get Firebase Admin instance
export function getFirebaseAdmin() {
  return admin;
}

// Check if Firebase is initialized
export function isFirebaseInitialized(): boolean {
  return firebaseInitialized;
}
