import { auth } from './firebaseAuth';

export function resolveUrl(url: string): string {
  if (!url || !url.startsWith('/')) {
    return url;
  }

  // In the browser, relative URLs starting with '/' are resolved natively by the browser
  // against the active origin and iframe context without protocol or hostname mismatch.
  if (typeof window !== 'undefined') {
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

function wrapResponseWithSafeJson(res: Response): Response {
  const originalJson = res.json.bind(res);

  // Override res.json to safely handle HTML / invalid JSON responses
  res.json = async () => {
    try {
      // Clone response to be able to read text safely if json() fails
      const clone = res.clone();
      try {
        return await originalJson();
      } catch (jsonErr) {
        const text = await clone.text().catch(() => '');
        console.warn('Endpoint returned non-JSON response (status: ' + res.status + '):', text.slice(0, 120));
        
        // Return structured fallback object instead of crashing UI
        return {
          ok: false,
          error: `Non-JSON response from server (status ${res.status})`,
          sources: [],
          collections: [],
          documents: [],
          messages: [],
          conversations: [],
          servers: [],
          syncLogs: [],
          mcpResources: [],
          status: res.status,
          raw: text.slice(0, 300)
        };
      }
    } catch (fallbackErr) {
      return {
        ok: false,
        error: 'Failed to read response body',
        sources: [],
        collections: [],
        documents: [],
        messages: [],
        conversations: [],
        servers: []
      };
    }
  };

  return res;
}

export async function fetchWithAuth(url: string | URL | Request, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers || {});
  
  if (auth && auth.currentUser) {
    try {
      const tokenPromise = auth.currentUser.getIdToken();
      let timeoutId: NodeJS.Timeout;
      const timeoutPromise = new Promise<string>((_, reject) => 
        timeoutId = setTimeout(() => reject(new Error('Auth token timeout')), 1500)
      );
      
      let tokenResolved = false;
      const safeTokenPromise = tokenPromise.then(res => {
        tokenResolved = true;
        return res;
      }).catch(err => {
        if (!tokenResolved) throw err;
        console.warn('Background token retrieval failed:', err);
        return null as any as string;
      });

      const token = await Promise.race([safeTokenPromise, timeoutPromise]);
      clearTimeout(timeoutId!);
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

  // Attach client-saved environment variables for runtime backend execution
  if (typeof window !== 'undefined') {
    const envKeys = ['DATABASE_URL', 'QDRANT_URL', 'QDRANT_API_KEY', 'MISTRAL_API_KEY', 'UNSTRUCTURED_API_KEY', 'GEMINI_API_KEY'];
    envKeys.forEach((k) => {
      try {
        const val = localStorage.getItem(`omnirag_env_${k}`);
        if (val && val.trim() !== '' && !val.includes('•')) {
          headers.set(`x-env-${k.toLowerCase().replace(/_/g, '-')}`, encodeURIComponent(val.trim()));
        }
      } catch (e) {}
    });
  }

  if (options.body && !headers.has('Content-Type') && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const rawUrl = typeof url === 'string' ? url : url.toString();
  const resolvedUrl = resolveUrl(rawUrl);

  try {
    const response = await fetch(resolvedUrl, {
      ...options,
      headers,
    });
    return wrapResponseWithSafeJson(response);
  } catch (primaryError) {
    console.warn(`Primary fetch to ${resolvedUrl} failed, trying relative/fallback URL:`, primaryError);
    
    const fallbackUrl = (resolvedUrl === rawUrl && rawUrl.startsWith('/'))
      ? (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null' ? `${window.location.origin}${rawUrl}` : rawUrl)
      : rawUrl;

    if (fallbackUrl !== resolvedUrl) {
      try {
        const response = await fetch(fallbackUrl, {
          ...options,
          headers,
        });
        return wrapResponseWithSafeJson(response);
      } catch (fallbackError) {
        console.warn(`Fallback fetch to ${fallbackUrl} also failed:`, fallbackError);
      }
    }

    const fallbackResponse = new Response(JSON.stringify({ 
      error: 'Network request failed',
      sources: [],
      collections: [],
      documents: [],
      syncLogs: [],
      mcpResources: [],
      conversations: [],
      messages: [],
      servers: []
    }), {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' },
    });

    return wrapResponseWithSafeJson(fallbackResponse);
  }
}

