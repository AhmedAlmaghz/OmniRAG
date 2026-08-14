import { firebaseConfig } from '../firebaseConfig';

let adminAuthInstance: any = null;
let adminDbInstance: any = null;
let initPromise: Promise<void> | null = null;

async function getFirebaseAdmin() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const { initializeApp, getApps, getApp } = await import('firebase-admin/app');
      const { getAuth } = await import('firebase-admin/auth');
      const { getFirestore } = await import('firebase-admin/firestore');

      const app = getApps().length === 0
        ? initializeApp({ projectId: firebaseConfig.projectId })
        : getApp();

      adminAuthInstance = getAuth(app);
      adminDbInstance = getFirestore(app);
    } catch (e) {
      console.warn('Firebase Admin SDK initialization bypassed:', (e as Error)?.message);
    }
  })();

  return initPromise;
}

export const adminAuth = {
  verifyIdToken: async (token: string) => {
    await getFirebaseAdmin();
    if (adminAuthInstance && typeof adminAuthInstance.verifyIdToken === 'function') {
      return await adminAuthInstance.verifyIdToken(token);
    }
    throw new Error('Firebase Admin Auth not available');
  },
};

export const adminDb = new Proxy({}, {
  get(_target, prop: string) {
    return (...args: any[]) => {
      if (adminDbInstance && typeof adminDbInstance[prop] === 'function') {
        return adminDbInstance[prop](...args);
      }
      if (adminDbInstance && adminDbInstance[prop] !== undefined) {
        return adminDbInstance[prop];
      }
      return null;
    };
  }
});


