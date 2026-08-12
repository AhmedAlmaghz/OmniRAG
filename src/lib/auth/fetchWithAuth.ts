import { auth } from './firebaseAuth';

export function resolveUrl(url: string): string {
  // Return relative URL on client
  if (typeof window !== 'undefined' || !url.startsWith('/')) {
    return url;
  }
  
  let origin = process.env.APP_URL || 'http://localhost:3000';
  if (origin.endsWith('/')) origin = origin.slice(0, -1);
  return `${origin}${url}`;
}

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

  if (options.body && !headers.has('Content-Type') && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const finalUrl = typeof url === 'string' ? resolveUrl(url) : url;
  return fetch(finalUrl, {
    ...options,
    headers,
  });
}
