import { auth } from './firebaseAuth';

export function resolveUrl(url: string): string {
  if (!url.startsWith('/')) {
    return url;
  }

  if (typeof window !== 'undefined') {
    // 1. Try window.__APP_ORIGIN__ injected in layout.tsx
    // @ts-ignore
    let appOrigin = window.__APP_ORIGIN__;
    
    // 2. Try window.location.origin if valid
    if (!appOrigin || appOrigin === 'null' || !appOrigin.startsWith('http')) {
      if (window.location.origin && window.location.origin !== 'null' && window.location.origin !== 'http://null' && window.location.origin.startsWith('http')) {
        appOrigin = window.location.origin;
      }
    }

    // 3. Try NEXT_PUBLIC_APP_URL
    if (!appOrigin || appOrigin === 'null' || !appOrigin.startsWith('http')) {
      const pubUrl = process.env.NEXT_PUBLIC_APP_URL;
      if (pubUrl && pubUrl !== 'null' && pubUrl.startsWith('http')) {
        appOrigin = pubUrl;
      }
    }

    if (appOrigin && appOrigin !== 'null' && appOrigin.startsWith('http')) {
      const cleanOrigin = appOrigin.endsWith('/') ? appOrigin.slice(0, -1) : appOrigin;
      return `${cleanOrigin}${url}`;
    }

    return url;
  }

  // On the server side (SSR / Node.js)
  let origin = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '';
  if (!origin || origin === 'null' || !origin.startsWith('http')) {
    const port = process.env.PORT || '3000';
    origin = `http://localhost:${port}`;
  } else if (origin.endsWith('/')) {
    origin = origin.slice(0, -1);
  }

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
