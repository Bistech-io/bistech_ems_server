import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import {
  extractClientIp,
  isIpAllowed,
  isValidIpOrCidr,
  normalizeIp,
  normalizeIpOrCidr,
} from './ip.util.js';

describe('ip.util', () => {
  describe('normalizeIp', () => {
    it('normalizes IPv4, IPv4-mapped IPv6, bracketed IPv6, and IPv4 with port', () => {
      expect(normalizeIp(' 203.0.113.10 ')).toBe('203.0.113.10');
      expect(normalizeIp('::ffff:203.0.113.10')).toBe('203.0.113.10');
      expect(normalizeIp('203.0.113.10:54321')).toBe('203.0.113.10');
      expect(normalizeIp('[2001:DB8::1]:443')).toBe('2001:db8::1');
      expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1');
      expect(normalizeIp('not-an-ip')).toBeNull();
      expect(normalizeIp('')).toBeNull();
    });
  });

  describe('normalizeIpOrCidr & isValidIpOrCidr', () => {
    it('validates IPv4, IPv6, and CIDR blocks', () => {
      expect(normalizeIpOrCidr('203.0.113.42')).toBe('203.0.113.42');
      expect(normalizeIpOrCidr('203.0.113.0/24')).toBe('203.0.113.0/24');
      expect(normalizeIpOrCidr('2001:DB8::/32')).toBe('2001:db8::/32');
      expect(isValidIpOrCidr('10.0.0.1/32')).toBe(true);
      expect(isValidIpOrCidr('203.0.113.0/33')).toBe(false);
      expect(isValidIpOrCidr('2001:db8::/129')).toBe(false);
      expect(isValidIpOrCidr('999.0.0.1')).toBe(false);
      expect(isValidIpOrCidr('office.example.com')).toBe(false);
    });
  });

  describe('extractClientIp', () => {
    it('prioritizes cf-connecting-ip, x-real-ip, x-forwarded-for, then req.ip', () => {
      expect(
        extractClientIp({
          headers: {
            'cf-connecting-ip': '198.51.100.7',
            'x-forwarded-for': '203.0.113.1, 10.0.0.1',
          },
          ip: '::ffff:127.0.0.1',
        } as unknown as Request),
      ).toBe('198.51.100.7');

      expect(
        extractClientIp({
          headers: {
            'x-forwarded-for': '203.0.113.55, 10.0.0.2',
          },
          ip: '127.0.0.1',
        } as unknown as Request),
      ).toBe('203.0.113.55');

      expect(
        extractClientIp({
          headers: { 'x-forwarded-for': 'spoofed-garbage' },
          ip: '::ffff:203.0.113.88',
        } as unknown as Request),
      ).toBe('203.0.113.88');
    });
  });

  describe('isIpAllowed', () => {
    it('allows any IP when allowlist is empty', () => {
      expect(isIpAllowed('198.51.100.20', [])).toBe(true);
      expect(isIpAllowed(null, [])).toBe(true);
    });

    it('enforces exact IPv4, IPv6, and CIDR allowlist rules', () => {
      const allowlist = ['203.0.113.42', '103.45.20.0/24', '2001:db8:abcd::/48'];

      expect(isIpAllowed('203.0.113.42', allowlist)).toBe(true);
      expect(isIpAllowed('::ffff:203.0.113.42', allowlist)).toBe(true);
      expect(isIpAllowed('103.45.20.199', allowlist)).toBe(true);
      expect(isIpAllowed('2001:0db8:abcd:0012::9', allowlist)).toBe(true);

      expect(isIpAllowed('203.0.113.43', allowlist)).toBe(false);
      expect(isIpAllowed('103.45.21.1', allowlist)).toBe(false);
      expect(isIpAllowed('2001:db8:9999::1', allowlist)).toBe(false);
      expect(isIpAllowed(null, allowlist)).toBe(false);
    });

    it('matches IPv4 and IPv6 loopback equivalently for local setups', () => {
      expect(isIpAllowed('::1', ['127.0.0.1'])).toBe(true);
      expect(isIpAllowed('127.0.0.1', ['::1'])).toBe(true);
    });
  });
});
