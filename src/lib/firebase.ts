import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, setLogLevel } from 'firebase/firestore';
import { firebaseConfig } from './firebaseConfig';

// Set Firestore log level to error to suppress idle stream warnings and other logs
try {
  setLogLevel('error');
} catch (e) {
  console.warn('Could not set Firestore log level:', e);
}

// Initialize Firebase App with SSR safety
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = typeof window !== 'undefined' ? getAuth(app) : null;

export const firestore = getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');

export default app;
