import admin from 'firebase-admin';
import logger from './logger';

let firebaseInitialized = false;

// Initialize Firebase Admin
export function initializeFirebase() {
  if (firebaseInitialized) {
    return;
  }

  try {
    // Check if Firebase credentials are provided
    if (!process.env.FIREBASE_PROJECT_ID) {
      logger.warn('⚠️  Firebase not configured - push notifications will be mocked');
      return;
    }

    // Initialize with environment variables
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });

    firebaseInitialized = true;
    logger.info('✅ Firebase Admin SDK initialized');
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