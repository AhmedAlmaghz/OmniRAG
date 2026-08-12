import { auth } from './firebaseAuth';

export function resolveUrl(url: string): string {
  if (!url.startsWith('/')) {
    return url;
  }

  if (typeof window !== 'undefined') {
    // 1. Try window.__APP_ORIGIN__ injected in layout.tsx
    // @ts-ignore
    const appOrigin = window.__APP_ORIGIN__;
    if (appOrigin && typeof appOrigin === 'string' && appOrigin !== 'null' && appOrigin.startsWith('http')) {
      const cleanOrigin = appOrigin.endsWith('/') ? appOrigin.slice(0, -1) : appOrigin;
      return `${cleanOrigin}${url}`;
    }

    // 2. Try window.location.origin
    if (window.location && window.location.origin && window.location.origin !== 'null' && window.location.origin !== 'http://null' && window.location.origin.startsWith('http')) {
      const cleanOrigin = window.location.origin.endsWith('/') ? window.location.origin.slice(0, -1) : window.location.origin;
      return `${cleanOrigin}${url}`;
    }

    // 3. Try window.location.href
    if (window.location && window.location.href && window.location.href.startsWith('http')) {
      try {
        const parsed = new URL(window.location.href);
        if (parsed.origin && parsed.origin !== 'null' && parsed.origin.startsWith('http')) {
          const cleanOrigin = parsed.origin.endsWith('/') ? parsed.origin.slice(0, -1) : parsed.origin;
          return `${cleanOrigin}${url}`;
        }
      } catch (e) {}
    }

    return url;
  }

  // On server side (SSR / Node)
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
      const tokenPromise = auth.currentUser.getIdToken();
      const timeoutPromise = new Promise<string>((_, reject) => 
        setTimeout(() => reject(new Error('Auth token timeout')), 1500)
      );
      const token = await Promise.race([tokenPromise, timeoutPromise]);
      headers.set('Authorization', `Bearer ${token}`);
    } catch (e) {
      console.warn('Firebase ID token retrieval bypassed, using fallback tenant auth:', e);
      let storedTenant = 'tenant-acme-01';
      if (typeof window !== 'undefined') {
        try {
          storedTenant = localStorage.getItem('omnirag-tenant-id') || 
                         localStorage.getItem('omnirag_tenant_id') || 
                         'tenant-acme-01';
        } catch (err) {}
      }
      headers.set('Authorization', `Bearer ${storedTenant}`);
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

  const rawUrl = typeof url === 'string' ? url : url.toString();
  const resolvedUrl = resolveUrl(rawUrl);

  try {
    return await fetch(resolvedUrl, {
      ...options,
      headers,
    });
  } catch (primaryError) {
    console.warn(`Primary fetch to ${resolvedUrl} failed, trying relative/fallback URL:`, primaryError);
    
    const fallbackUrl = (resolvedUrl === rawUrl && rawUrl.startsWith('/'))
      ? (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null' ? `${window.location.origin}${rawUrl}` : rawUrl)
      : rawUrl;

    if (fallbackUrl !== resolvedUrl) {
      try {
        return await fetch(fallbackUrl, {
          ...options,
          headers,
        });
      } catch (fallbackError) {
        console.warn(`Fallback fetch to ${fallbackUrl} also failed:`, fallbackError);
      }
    }

    return new Response(JSON.stringify({ 
      error: 'Network request failed',
      sources: [],
      collections: [],
      documents: [],
      syncLogs: [],
      mcpResources: []
    }), {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

