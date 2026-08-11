import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '../../../firebase-applet-config.json';

const app = getApps().length === 0 ? initializeApp({ projectId: firebaseConfig.projectId }) : getApp();

export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);
