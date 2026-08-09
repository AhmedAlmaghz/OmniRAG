import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App with SSR safety
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = typeof window !== 'undefined' ? getAuth(app) : null;

export const firestore = getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');

export default app;
