import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { ToolError } from './tool.types';

/** Returns true for loopback, private, link-local, CGNAT, multicast, reserved and metadata ranges. */
export function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number, number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]!);
    return (
      /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v) || v.startsWith('64:ff9b:') || v.startsWith('2001:db8')
    );
  }
  return true;
}

export interface OutboundPolicy {
  allowedHosts: string[];
  allowHttp: boolean;
}

/**
 * Validates an outbound URL: scheme, explicit host allowlist, no credentials, standard ports,
 * and every resolved address must be public. Returns the parsed URL.
 */
export async function assertSafeOutboundUrl(raw: string, policy: OutboundPolicy): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ToolError('INVALID_URL', 'URL is not valid');
  }
  if (url.protocol !== 'https:' && !(policy.allowHttp && url.protocol === 'http:')) {
    throw new ToolError('URL_NOT_ALLOWED', 'Only https URLs are allowed');
  }
  if (url.username || url.password)
    throw new ToolError('URL_NOT_ALLOWED', 'Credentials in URLs are not allowed');
  if (url.port && !['443', '80'].includes(url.port))
    throw new ToolError('URL_NOT_ALLOWED', 'Non-standard ports are not allowed');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const allowed = policy.allowedHosts.some((h) => {
    const rule = h.toLowerCase();
    return rule.startsWith('*.')
      ? host.endsWith(rule.slice(1)) && host !== rule.slice(2)
      : host === rule;
  });
  if (!allowed) throw new ToolError('HOST_NOT_ALLOWED', `Host ${host} is not on the allowlist`);
  if (net.isIP(host)) {
    if (isBlockedAddress(host))
      throw new ToolError('URL_NOT_ALLOWED', 'Address is not publicly routable');
    return url;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new ToolError('DNS_FAILED', `Could not resolve ${host}`, true);
  }
  if (addrs.length === 0 || addrs.some((a) => isBlockedAddress(a.address))) {
    throw new ToolError('URL_NOT_ALLOWED', 'Host resolves to a non-public address');
  }
  return url;
}
