function normalizeLoopbackHost(hostname: string): string {
  const value = hostname.trim().toLowerCase();
  if (value === 'localhost' || value === '127.0.0.1' || value === '::1') {
    return 'loopback';
  }
  return value;
}

function effectivePort(url: URL): string {
  if (url.port) return url.port;
  if (url.protocol === 'wss:' || url.protocol === 'https:') return '443';
  if (url.protocol === 'ws:' || url.protocol === 'http:') return '80';
  return '';
}

function normalizePath(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function normalizeProtocol(protocol: string): string {
  // Treat ws/wss and http/https as equivalent families
  if (protocol === 'wss:' || protocol === 'ws:') return 'ws:';
  if (protocol === 'https:' || protocol === 'http:') return 'http:';
  return protocol;
}

/**
 * Compare two gateway URLs semantically so loopback aliases such as
 * localhost/127.0.0.1 and ws/wss mismatches do not break the managed
 * official-gateway path.
 */
export function areGatewayUrlsEquivalent(left?: string | null, right?: string | null): boolean {
  const a = left?.trim();
  const b = right?.trim();
  if (!a || !b) return false;

  try {
    const leftUrl = new URL(a);
    const rightUrl = new URL(b);
    return (
      normalizeProtocol(leftUrl.protocol) === normalizeProtocol(rightUrl.protocol) &&
      normalizeLoopbackHost(leftUrl.hostname) === normalizeLoopbackHost(rightUrl.hostname) &&
      effectivePort(leftUrl) === effectivePort(rightUrl) &&
      normalizePath(leftUrl.pathname) === normalizePath(rightUrl.pathname) &&
      leftUrl.search === rightUrl.search
    );
  } catch {
    return a === b;
  }
}
