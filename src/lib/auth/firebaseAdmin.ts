import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseConfig } from '../firebaseConfig';

let app: any = null;
let adminAuth: any = null;
let adminDb: any = null;

try {
  app = getApps().length === 0 ? initializeApp({ projectId: firebaseConfig.projectId }) : getApp();
  adminAuth = getAuth(app);
  adminDb = getFirestore(app);
} catch (e) {
  console.warn('Firebase Admin SDK initialization bypassed:', (e as Error)?.message);
  adminAuth = {
    verifyIdToken: async () => {
      throw new Error('Firebase Admin Auth not initialized');
    },
  };
  adminDb = null;
}

export { adminAuth, adminDb };

