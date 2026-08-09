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
import { doc, setDoc, getDoc } from 'firebase/firestore';
import firebaseConfig from '../../../firebase-applet-config.json';
import { firestore } from '../firebase';
import { Tenant, Collection, MCPServerConfig, SourceConnector, Document, DocumentChunk } from '../types/omnirag';
import { seedNewTenant } from './seedTenantAction';

// Initialize Firebase App & Auth with SSR Safety
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = typeof window !== 'undefined' ? getAuth(app) : null;

/**
 * Register a new user, create their isolated Tenant, and seed initial demo data
 */
export async function signUpUser(email: string, password: string, workspaceName: string): Promise<{ user: User; tenantId: string }> {
  if (!auth) {
    throw new Error('Firebase Auth is not initialized');
  }

  // 1. Create User in Firebase Auth
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;
  const tenantId = `tenant-${user.uid}`;

  // 2. Create the Tenant document in Firestore
  const newTenant: Tenant = {
    id: tenantId,
    name: workspaceName || `مساحة عمل ${email}`,
    plan: 'enterprise',
    createdAt: new Date().toISOString(),
    settings: {
      chunkSize: 500,
      chunkOverlap: 50,
      hybridWeights: { semantic: 0.7, lexical: 0.3 },
      defaultModel: 'gemini-3.6-flash',
      dataRetentionDays: 90,
      enablePiiRedaction: true,
      enablePromptSanitizer: true,
    },
  };

  await setDoc(doc(firestore, 'tenants', tenantId), newTenant);

  // 3. Seed Initial Demo Data for this new Tenant
  try {
    await seedNewTenant(tenantId, newTenant.name);
  } catch (error) {
    console.error('Failed to seed new tenant, continuing anyway:', error);
  }

  return { user, tenantId };
}

/**
 * Sign in an existing user and retrieve their tenant ID
 */
export async function signInUser(email: string, password: string): Promise<{ user: User; tenantId: string }> {
  if (!auth) {
    throw new Error('Firebase Auth is not initialized');
  }

  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;
  const tenantId = `tenant-${user.uid}`;

  // Verify tenant document exists, if not create it
  const tenantDocRef = doc(firestore, 'tenants', tenantId);
  const tenantSnap = await getDoc(tenantDocRef);
  
  if (!tenantSnap.exists()) {
    const newTenant: Tenant = {
      id: tenantId,
      name: `مساحة عمل ${email}`,
      plan: 'enterprise',
      createdAt: new Date().toISOString(),
      settings: {
        chunkSize: 500,
        chunkOverlap: 50,
        hybridWeights: { semantic: 0.7, lexical: 0.3 },
        defaultModel: 'gemini-3.6-flash',
        dataRetentionDays: 90,
        enablePiiRedaction: true,
        enablePromptSanitizer: true,
      },
    };
    await setDoc(tenantDocRef, newTenant);
    await seedNewTenant(tenantId, newTenant.name);
  }

  return { user, tenantId };
}

/**
 * Sign in using Google OAuth Popup
 */
export async function signInWithGoogle(): Promise<{ user: User; tenantId: string }> {
  if (!auth) {
    throw new Error('Firebase Auth is not initialized');
  }

  const provider = new GoogleAuthProvider();
  const userCredential = await signInWithPopup(auth, provider);
  const user = userCredential.user;
  const tenantId = `tenant-${user.uid}`;

  // Verify tenant document exists, if not create it
  const tenantDocRef = doc(firestore, 'tenants', tenantId);
  const tenantSnap = await getDoc(tenantDocRef);
  
  if (!tenantSnap.exists()) {
    const newTenant: Tenant = {
      id: tenantId,
      name: user.displayName || `مساحة عمل ${user.email || 'جوجل'}`,
      plan: 'enterprise',
      createdAt: new Date().toISOString(),
      settings: {
        chunkSize: 500,
        chunkOverlap: 50,
        hybridWeights: { semantic: 0.7, lexical: 0.3 },
        defaultModel: 'gemini-3.6-flash',
        dataRetentionDays: 90,
        enablePiiRedaction: true,
        enablePromptSanitizer: true,
      },
    };
    await setDoc(tenantDocRef, newTenant);
    try {
      await seedNewTenant(tenantId, newTenant.name);
    } catch (error) {
      console.error('Failed to seed new Google tenant:', error);
    }
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

/**
 * Seed a newly created tenant with isolated, fully functional starter datasets
 */
