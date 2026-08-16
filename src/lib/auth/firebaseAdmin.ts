import { initializeApp, getApps, getApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { firebaseConfig } from '../firebaseConfig';

/**
 * Firebase Admin Auth (server-only).
 *
 * `firebase-admin` is listed in `next.config.ts` `serverExternalPackages`, so it
 * is kept out of the webpack bundle and resolved from `node_modules` at runtime
 * — use plain static imports (the previous dynamic `import('firebase-admin/...')`
 * was fragile under Vercel serverless and left the Auth instance null).
 *
 * Verifying Firebase ID tokens requires a credential on non-GCP hosts (Vercel
 * has no Application Default Credentials). Configure one via the
 * `FIREBASE_SERVICE_ACCOUNT_KEY` env var holding the full service-account JSON.
 */

let adminAuthInstance: Auth | null = null;
let initialized = false;
let initError: string | null = null;

/**
 * Resolve a credential for firebase-admin. Order:
 *  1. `FIREBASE_SERVICE_ACCOUNT_KEY` — full service-account JSON (Vercel etc.).
 *  2. Application Default Credentials — GCP runtimes, or a `GOOGLE_APPLICATION_CREDENTIALS` file.
 *  3. `undefined` — projectId-only init; `getAuth()` will then fail and the caller refuses to bypass auth.
 */
function resolveCredential() {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (saJson && saJson.trim()) {
    try {
      return cert(JSON.parse(saJson));
    } catch {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_KEY is set but is not valid JSON. Provide the full Firebase service-account key object as a single-line JSON string.',
      );
    }
  }
  try {
    return applicationDefault();
  } catch {
    return undefined;
  }
}

function init(): void {
  if (initialized) return;
  initialized = true;
  try {
    const credential = resolveCredential();
    const appOptions: { projectId: string; credential?: ReturnType<typeof cert> } = {
      projectId: firebaseConfig.projectId,
    };
    if (credential) appOptions.credential = credential;

    const app = getApps().length === 0 ? initializeApp(appOptions) : getApp();
    adminAuthInstance = getAuth(app);
  } catch (e) {
    initError = (e as Error)?.message || String(e);
  }
}

export const adminAuth = {
  async verifyIdToken(token: string) {
    init();
    if (adminAuthInstance) {
      return adminAuthInstance.verifyIdToken(token);
    }
    // Auth could not be initialized (credentials missing/invalid). Never bypass:
    // reject the request with an actionable reason so the operator can fix config.
    throw new Error(
      initError && initError.trim()
        ? `Firebase Admin Auth not available: ${initError}`
        : 'Firebase Admin Auth not available: no service account configured. Set FIREBASE_SERVICE_ACCOUNT_KEY (full Firebase service-account JSON) on the server to verify ID tokens.',
    );
  },
};
