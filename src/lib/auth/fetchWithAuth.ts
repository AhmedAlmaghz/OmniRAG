import { auth } from './firebaseAuth';

/**
 * A wrapper around fetch that automatically injects the Firebase ID Token
 * for authenticated API requests.
 */
export function resolveUrl(url: string): string {
  if (typeof window === 'undefined' || !url.startsWith('/')) {
    return url;
  }

  // 1. Try server-injected origin
  let origin = (window as any).__APP_ORIGIN__;

  // 2. Try standard window location origin
  if (!origin || origin === 'null') {
    origin = window.location.origin;
  }

  // 3. Try parsing window location href
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

  // Fallback: If origin is still null or blank (common in sandboxed iframes or srcdoc),
  // detect it from active DOM resource scripts/links which are fully resolved by the browser.
  // CRITICAL: We MUST filter to ensure the scripts belong to our own Next.js assets
  // (containing _next/, /static/, /chunks/, or /css) to avoid incorrectly returning external 
  // script domains like apis.google.com or gstatic.com.
  if (!origin || origin === 'null') {
    try {
      const scripts = Array.from(document.getElementsByTagName('script'));
      for (const script of scripts) {
        const src = script.src;
        if (src && src.startsWith('http')) {
          if (src.includes('_next/') || src.includes('/static/') || src.includes('/chunks/') || src.includes('/bundle')) {
            const parsed = new URL(src);
            if (parsed.origin && parsed.origin !== 'null') {
              origin = parsed.origin;
              break;
            }
          }
        }
      }

      if (!origin || origin === 'null') {
        const links = Array.from(document.getElementsByTagName('link'));
        for (const link of links) {
          const href = link.href;
          if (href && href.startsWith('http')) {
            if (href.includes('_next/') || href.includes('/static/') || href.includes('/chunks/') || href.includes('/css')) {
              const parsed = new URL(href);
              if (parsed.origin && parsed.origin !== 'null') {
                origin = parsed.origin;
                break;
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('Failed to detect origin from DOM resources:', e);
    }
  }

  if (origin && origin !== 'null') {
    // Force HTTPS if running under HTTPS, or on Cloud Run/production hosts
    if (origin.startsWith('http://')) {
      const shouldForceHttps = (typeof window !== 'undefined' && window.location.protocol === 'https:') ||
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

  return fetch(finalUrl, {
    ...options,
    headers,
  });
}
