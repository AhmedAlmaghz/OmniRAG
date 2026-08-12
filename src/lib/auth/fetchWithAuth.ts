import { auth } from './firebaseAuth';

export function resolveUrl(url: string): string {
  if (typeof window === 'undefined' || !url.startsWith('/')) {
    return url;
  }
  
  let origin = '';
  const envUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  if (envUrl && envUrl !== 'null') {
    origin = envUrl;
  }

  // Fallback to window.location.origin if it's not null and we don't have envUrl
  if (!origin && window.location.origin && window.location.origin !== 'null') {
    origin = window.location.origin;
  }

  if (origin && origin !== 'null') {
    if (origin.endsWith('/')) {
      origin = origin.slice(0, -1);
    }
    // Force HTTPS
    if (origin.startsWith('http://')) {
      const shouldForceHttps = window.location.protocol === 'https:' ||
        origin.includes('run.app') ||
        origin.includes('europe-west1.run.app');
      if (shouldForceHttps) {
        origin = origin.replace('http://', 'https://');
      }
    }
    return `${origin}${url}`;
  }
  
  // If we couldn't resolve an absolute URL, just return the relative one and hope the browser allows it.
  return url;
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
