import { describe, expect, it } from 'vitest';
import { assertSafeOutboundUrl, isBlockedAddress } from './ssrf';

const policy = {
  allowedHosts: ['api.example.com', '*.trusted.io', '93.184.216.34'],
  allowHttp: false,
};

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '224.0.0.1',
  ])('blocks %s', (ip) => expect(isBlockedAddress(ip)).toBe(true));
  it.each(['93.184.216.34', '8.8.8.8', '2606:4700::1111'])('allows public %s', (ip) =>
    expect(isBlockedAddress(ip)).toBe(false),
  );
});

describe('assertSafeOutboundUrl', () => {
  const code = async (url: string) => {
    try {
      await assertSafeOutboundUrl(url, policy);
      return 'ok';
    } catch (e) {
      return (e as { code: string }).code;
    }
  };
  it('rejects non-https, credentials, odd ports and unlisted hosts', async () => {
    expect(await code('http://api.example.com/x')).toBe('URL_NOT_ALLOWED');
    expect(await code('https://user:pw@api.example.com/')).toBe('URL_NOT_ALLOWED');
    expect(await code('https://api.example.com:8443/')).toBe('URL_NOT_ALLOWED');
    expect(await code('https://evil.com/')).toBe('HOST_NOT_ALLOWED');
    expect(await code('file:///etc/passwd')).toBe('URL_NOT_ALLOWED');
    expect(await code('not a url')).toBe('INVALID_URL');
  });
  it('wildcards match subdomains only', async () => {
    expect(await code('https://trusted.io/')).toBe('HOST_NOT_ALLOWED');
    expect(await code('https://eviltrusted.io/')).toBe('HOST_NOT_ALLOWED');
  });
  it('allows a listed public IP literal and blocks listed private literals', async () => {
    expect(await code('https://93.184.216.34/')).toBe('ok');
    const r = await assertSafeOutboundUrl('https://127.0.0.1/', {
      allowedHosts: ['127.0.0.1'],
      allowHttp: false,
    }).catch((e) => e.code);
    expect(r).toBe('URL_NOT_ALLOWED');
  });
  it('blocks allowlisted names that resolve to private addresses (DNS rebinding style)', async () => {
    const r = await assertSafeOutboundUrl('https://localhost/', {
      allowedHosts: ['localhost'],
      allowHttp: false,
    }).catch((e) => e.code);
    expect(r).toBe('URL_NOT_ALLOWED');
  });
});
