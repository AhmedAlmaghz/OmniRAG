import { auth } from './firebaseAuth';

/**
 * A wrapper around fetch that automatically injects the Firebase ID Token
 * for authenticated API requests.
 */
export async function fetchWithAuth(url: string | URL | Request, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers || {});
  
  if (auth && auth.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken();
      headers.set('Authorization', `Bearer ${token}`);
    } catch (e) {
      console.warn('Failed to get Firebase ID token', e);
    }
  } else {
    // Check if we are using the ACME demo tenant bypass
    // The main app stores it in local storage or passes it, but we can read from localStorage
    if (typeof window !== 'undefined') {
      const storedTenant = localStorage.getItem('omnirag_tenant_id');
      if (storedTenant === 'tenant-acme-01') {
        headers.set('Authorization', `Bearer ${storedTenant}`);
      }
    }
  }

  // Ensure content-type is json if not provided and we have a body
  if (options.body && !headers.has('Content-Type') && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(url, {
    ...options,
    headers,
  });
}
