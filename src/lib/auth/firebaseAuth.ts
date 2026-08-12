import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth';
import { initializeApp, getApps, getApp } from 'firebase/app';
import firebaseConfig from '../../../firebase-applet-config.json';
import { Tenant } from '../types/omnirag';
import { seedNewTenant } from '../../actions/seedTenantAction';

// Initialize Firebase App & Auth with SSR Safety
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = typeof window !== 'undefined' ? getAuth(app) : null;

// Helper function to create a deterministic hash ID from email string
function stringHashUid(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return 'user-' + Math.abs(hash).toString(36);
}

/**
 * Register a new user, create their isolated Tenant, and seed initial demo data
 */
export async function signUpUser(email: string, password: string, workspaceName: string): Promise<{ user: User; tenantId: string }> {
  let user: User;
  let tenantId: string;

  try {
    if (!auth) {
      throw new Error('Firebase Auth is not initialized');
    }
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    user = userCredential.user;
    tenantId = `tenant-${user.uid}`;
  } catch (err: any) {
    if (err.code === 'auth/operation-not-allowed' || err.message?.includes('operation-not-allowed')) {
      console.warn('Firebase Email/Password auth is not enabled in Console. Falling back to local tenant isolation.');
      const simulatedUid = stringHashUid(email);
      tenantId = `tenant-${simulatedUid}`;
      user = {
        uid: simulatedUid,
        email: email,
        displayName: workspaceName || `مساحة عمل ${email}`,
      } as unknown as User;
    } else {
      throw err;
    }
  }

  // Seed Initial Demo Data for this new Tenant
  try {
    await seedNewTenant(tenantId, workspaceName || `مساحة عمل ${email}`);
  } catch (error) {
    console.error('Failed to seed new tenant, continuing anyway:', error);
  }

  return { user, tenantId };
}

/**
 * Sign in an existing user and retrieve their tenant ID
 */
export async function signInUser(email: string, password: string): Promise<{ user: User; tenantId: string }> {
  let user: User;
  let tenantId: string;

  try {
    if (!auth) {
      throw new Error('Firebase Auth is not initialized');
    }
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    user = userCredential.user;
    tenantId = `tenant-${user.uid}`;
  } catch (err: any) {
    if (err.code === 'auth/operation-not-allowed' || err.message?.includes('operation-not-allowed')) {
      console.warn('Firebase Email/Password auth is not enabled in Console. Falling back to local tenant isolation.');
      const simulatedUid = stringHashUid(email);
      tenantId = `tenant-${simulatedUid}`;
      user = {
        uid: simulatedUid,
        email: email,
        displayName: `مساحة عمل ${email}`,
      } as unknown as User;
    } else {
      throw err;
    }
  }

  // Verify tenant data exists in DB, if not seed it
  try {
    const { db } = await import('../storage/db');
    const documents = await db.getDocuments(tenantId);
    if (documents.length === 0) {
      await seedNewTenant(tenantId, `مساحة عمل ${email}`);
    }
  } catch (err) {
    console.log('Tenant verification/seeding failed during signInUser:', err);
  }

  return { user, tenantId };
}

/**
 * Sign in using Google OAuth Popup
 */
export async function signInWithGoogle(): Promise<{ user: User; tenantId: string }> {
  let user: User;
  let tenantId: string;

  try {
    if (!auth) {
      throw new Error('Firebase Auth is not initialized');
    }
    const provider = new GoogleAuthProvider();
    const userCredential = await signInWithPopup(auth, provider);
    user = userCredential.user;
    tenantId = `tenant-${user.uid}`;
  } catch (err: any) {
    if (err.code === 'auth/operation-not-allowed' || err.message?.includes('operation-not-allowed')) {
      console.warn('Firebase Google Auth is not enabled in Console. Falling back to demo Google tenant.');
      const simulatedUid = 'google-demo-user';
      tenantId = `tenant-${simulatedUid}`;
      user = {
        uid: simulatedUid,
        email: 'google-user@omnirag.io',
        displayName: 'مستخدم Google التجريبي',
      } as unknown as User;
    } else {
      throw err;
    }
  }

  // Verify tenant data exists in DB, if not seed it
  try {
    const { db } = await import('../storage/db');
    const documents = await db.getDocuments(tenantId);
    if (documents.length === 0) {
      await seedNewTenant(tenantId, user.displayName || `مساحة عمل ${user.email || 'جوجل'}`);
    }
  } catch (err) {
    console.log('Tenant verification/seeding failed during signInWithGoogle:', err);
  }

  return { user, tenantId };
}

/**
 * Sign out the current user
 */
export async function logOutUser(): Promise<void> {
  if (!auth) {
    throw new Error('Firebase Auth is not initialized');
  }
  await signOut(auth);
}
