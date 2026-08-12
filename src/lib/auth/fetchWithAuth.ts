import { auth } from './firebaseAuth';

/**
 * A wrapper around fetch that automatically injects the Firebase ID Token
 * for authenticated API requests.
 */
export function resolveUrl(url: string): string {
  if (typeof window === 'undefined' || !url.startsWith('/')) {
    return url;
  }

  let origin = '';

  // 1. Extract directly from window.location.href via regex.
  // This is the absolute most reliable method under any browser sandbox (even when location.origin is "null")
  try {
    if (window.location && window.location.href) {
      const match = window.location.href.match(/^(https?:\/\/[^\/]+)/i);
      if (match && match[1] && !match[1].includes('null') && !match[1].startsWith('about:') && !match[1].startsWith('data:')) {
        origin = match[1];
      }
    }
  } catch (e) {
    // Ignored
  }

  // 2. Try server-injected window.__APP_ORIGIN__
  if (!origin || origin === 'null' || origin.includes('localhost:3000')) {
    const injected = (window as any).__APP_ORIGIN__;
    if (injected && injected !== 'null') {
      origin = injected;
    }
  }

  // 3. Try NEXT_PUBLIC_APP_URL
  if (!origin || origin === 'null' || origin.includes('localhost:3000')) {
    const envUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    if (envUrl && envUrl !== 'null') {
      origin = envUrl;
    }
  }

  // 4. Try document.referrer
  if (!origin || origin === 'null' || origin.includes('localhost:3000')) {
    try {
      if (document.referrer) {
        const match = document.referrer.match(/^(https?:\/\/[^\/]+)/i);
        if (match && match[1] && !match[1].includes('google.com') && !match[1].includes('gstatic.com')) {
          origin = match[1];
        }
      }
    } catch (e) {
      // Ignored
    }
  }

  // 5. Try ancestorOrigins
  if (!origin || origin === 'null' || origin.includes('localhost:3000')) {
    try {
      const ancestors = (window.location as any).ancestorOrigins;
      if (ancestors && ancestors.length > 0) {
        for (let i = 0; i < ancestors.length; i++) {
          const anc = ancestors[i];
          if (anc && anc !== 'null' && !anc.includes('google.com') && !anc.includes('gstatic.com')) {
            origin = anc;
            break;
          }
        }
      }
    } catch (e) {
      // Ignored
    }
  }

  // 6. Final safe defaults
  if (!origin || origin === 'null') {
    origin = window.location.origin || '';
  }

  if (origin && origin !== 'null') {
    if (origin.endsWith('/')) {
      origin = origin.slice(0, -1);
    }
    // Force HTTPS if running under HTTPS, or on Cloud Run/production hosts
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

  return url;
}

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

  const finalUrl = typeof url === 'string' ? resolveUrl(url) : url;
  if (typeof window !== 'undefined') {
    console.log(`[fetchWithAuth] Resolving URL: ${url} -> ${finalUrl}`);
  }

  return fetch(finalUrl, {
    ...options,
    headers,
  });
}
