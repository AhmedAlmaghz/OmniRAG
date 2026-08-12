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
    if (typeof window !== 'undefined') {
      let storedTenant = 'tenant-acme-01';
      try {
        storedTenant = localStorage.getItem('omnirag-tenant-id') || 
                       localStorage.getItem('omnirag_tenant_id') || 
                       'tenant-acme-01';
      } catch (e) {
        console.warn('Failed to safely read tenant-id from localStorage due to sandboxing:', e);
      }
      headers.set('Authorization', `Bearer ${storedTenant}`);
    }
  }

  // Ensure content-type is json if not provided and we have a body
  if (options.body && !headers.has('Content-Type') && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  // Under sandboxed iframes, relative URLs can occasionally resolve incorrectly.
  // Resolve them explicitly against the current window origin or href to prevent opaque origin ("null") issues.
  let finalUrl = url;
  if (typeof window !== 'undefined' && typeof url === 'string' && url.startsWith('/')) {
    let origin = window.location.origin;
    if (!origin || origin === 'null') {
      try {
        const parsedUrl = new URL(window.location.href);
        if (parsedUrl.origin && parsedUrl.origin !== 'null') {
          origin = parsedUrl.origin;
        }
      } catch (e) {
        console.warn('Failed to parse origin from window.location.href:', e);
      }
    }
    if (origin && origin !== 'null') {
      finalUrl = `${origin}${url}`;
    }
  }

  return fetch(finalUrl, {
    ...options,
    headers,
  });
}
