import { isIP } from 'node:net';
import type { Request } from 'express';

/**
 * Normalizes a raw IP address string:
 * - trims whitespace and brackets (e.g. "[::1]")
 * - strips IPv4-mapped IPv6 prefix ("::ffff:203.0.113.10" -> "203.0.113.10")
 * - strips IPv6 zone identifiers (e.g. "fe80::1%eth0" -> "fe80::1")
 * - strips trailing port on IPv4:port strings (e.g. "203.0.113.10:54321")
 * Returns null if the resulting value is not a valid IPv4 or IPv6 address.
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;

  let value = raw.trim();
  if (!value) return null;

  // Handle bracketed IPv6 with optional port: [2001:db8::1]:443
  if (value.startsWith('[')) {
    const closeIdx = value.indexOf(']');
    if (closeIdx !== -1) {
      value = value.slice(1, closeIdx);
    }
  }

  // Strip IPv6 zone id (e.g. fe80::1%eth0)
  const zoneIdx = value.indexOf('%');
  if (zoneIdx !== -1) {
    value = value.slice(0, zoneIdx);
  }

  // Strip port from IPv4:port (only when there is a single colon)
  if (value.includes('.') && value.includes(':') && !value.toLowerCase().startsWith('::ffff:')) {
    const parts = value.split(':');
    if (parts.length === 2 && /^\d+$/.test(parts[1])) {
      value = parts[0];
    }
  }

  // Unwrap IPv4-mapped IPv6 address (::ffff:a.b.c.d)
  if (value.toLowerCase().startsWith('::ffff:')) {
    const mappedV4 = value.slice(7);
    if (isIP(mappedV4) === 4) {
      return mappedV4;
    }
  }

  const version = isIP(value);
  if (version === 4) return value;
  if (version === 6) return value.toLowerCase();
  return null;
}

/**
 * Extracts the client's normalized IP address from an incoming Express request.
 * Respects Cloudflare (`cf-connecting-ip`), `x-real-ip`, `x-forwarded-for`,
 * `req.ip`, and `req.socket.remoteAddress`, validating every candidate with `net.isIP`.
 */
export function extractClientIp(req: Request | undefined | null): string | null {
  if (!req) return null;

  const headers = req.headers ?? {};
  const candidates: Array<string | undefined> = [];

  const cfIp = headers['cf-connecting-ip'];
  if (typeof cfIp === 'string') {
    candidates.push(cfIp);
  }

  const realIp = headers['x-real-ip'];
  if (typeof realIp === 'string') {
    candidates.push(realIp);
  }

  const forwardedFor = headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string') {
    for (const part of forwardedFor.split(',')) {
      candidates.push(part);
    }
  } else if (Array.isArray(forwardedFor)) {
    for (const item of forwardedFor) {
      for (const part of item.split(',')) {
        candidates.push(part);
      }
    }
  }

  if (typeof req.ip === 'string') {
    candidates.push(req.ip);
  }

  if (typeof req.socket?.remoteAddress === 'string') {
    candidates.push(req.socket.remoteAddress);
  }

  for (const candidate of candidates) {
    const normalized = normalizeIp(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

/**
 * Validates and normalizes an IPv4, IPv6, or CIDR entry (e.g. "203.0.113.10" or "203.0.113.0/24").
 * Returns the canonical string or null if invalid.
 */
export function normalizeIpOrCidr(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const slashIdx = trimmed.indexOf('/');
  if (slashIdx === -1) {
    return normalizeIp(trimmed);
  }

  const ipPart = trimmed.slice(0, slashIdx);
  const prefixPart = trimmed.slice(slashIdx + 1);
  if (!/^\d+$/.test(prefixPart)) {
    return null;
  }

  const normalizedIp = normalizeIp(ipPart);
  if (!normalizedIp) return null;

  const version = isIP(normalizedIp);
  const prefix = Number(prefixPart);
  if (version === 4 && prefix >= 0 && prefix <= 32) {
    return `${normalizedIp}/${prefix}`;
  }
  if (version === 6 && prefix >= 0 && prefix <= 128) {
    return `${normalizedIp}/${prefix}`;
  }

  return null;
}

export function isValidIpOrCidr(raw: string): boolean {
  return normalizeIpOrCidr(raw) !== null;
}

function ipv4ToBigInt(ip: string): bigint {
  const octets = ip.split('.').map(Number);
  return (
    (BigInt(octets[0]) << 24n) |
    (BigInt(octets[1]) << 16n) |
    (BigInt(octets[2]) << 8n) |
    BigInt(octets[3])
  );
}

function ipv6ToBigInt(ip: string): bigint {
  // Handle embedded IPv4 tail if present (e.g. ::ffff:192.0.2.128)
  let normalized = ip.toLowerCase();
  const lastColon = normalized.lastIndexOf(':');
  if (lastColon !== -1 && normalized.slice(lastColon + 1).includes('.')) {
    const v4 = ipv4ToBigInt(normalized.slice(lastColon + 1));
    const hi = ((v4 >> 16n) & 0xffffn).toString(16);
    const lo = (v4 & 0xffffn).toString(16);
    normalized = `${normalized.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const [leftRaw, rightRaw] = normalized.split('::');
  const left = leftRaw ? leftRaw.split(':').filter(Boolean) : [];
  const right = rightRaw !== undefined ? rightRaw.split(':').filter(Boolean) : [];
  const missing = rightRaw !== undefined ? 8 - (left.length + right.length) : 0;

  const groups = [
    ...left,
    ...Array.from({ length: Math.max(0, missing) }, () => '0'),
    ...right,
  ];

  let result = 0n;
  for (const group of groups) {
    result = (result << 16n) | BigInt(parseInt(group || '0', 16));
  }
  return result;
}

function matchesCidr(clientIp: string, cidrEntry: string): boolean {
  const [networkIp, prefixStr] = cidrEntry.split('/');
  const clientVersion = isIP(clientIp);
  const networkVersion = isIP(networkIp);
  if (clientVersion === 0 || clientVersion !== networkVersion) {
    return false;
  }

  const prefix = Number(prefixStr);
  if (clientVersion === 4) {
    if (prefix === 0) return true;
    const shift = BigInt(32 - prefix);
    return (ipv4ToBigInt(clientIp) >> shift) === (ipv4ToBigInt(networkIp) >> shift);
  }

  if (prefix === 0) return true;
  const shift = BigInt(128 - prefix);
  return (ipv6ToBigInt(clientIp) >> shift) === (ipv6ToBigInt(networkIp) >> shift);
}

function isLoopbackIp(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1';
}

/**
 * Checks whether `clientIp` is permitted by `allowlist`.
 * - When `allowlist` is empty, restriction is disabled and returns `true`.
 * - When `allowlist` is non-empty, `clientIp` must match at least one exact IP or CIDR block.
 */
export function isIpAllowed(
  clientIp: string | null | undefined,
  allowlist: readonly string[] | null | undefined,
): boolean {
  const cleanList = (allowlist ?? [])
    .map((entry) => normalizeIpOrCidr(entry))
    .filter((entry): entry is string => entry !== null);

  if (cleanList.length === 0) {
    return true;
  }

  const normalizedClient = normalizeIp(clientIp);
  if (!normalizedClient) {
    return false;
  }

  for (const rule of cleanList) {
    if (rule.includes('/')) {
      if (matchesCidr(normalizedClient, rule)) {
        return true;
      }
      continue;
    }

    if (normalizedClient === rule) {
      return true;
    }

    // Compare canonical IPv6 numeric representation (e.g. 2001:0db8::1 == 2001:db8::1)
    if (isIP(normalizedClient) === 6 && isIP(rule) === 6) {
      if (ipv6ToBigInt(normalizedClient) === ipv6ToBigInt(rule)) {
        return true;
      }
    }

    // Treat IPv4 and IPv6 loopback equivalently for local testing convenience
    if (isLoopbackIp(normalizedClient) && isLoopbackIp(rule)) {
      return true;
    }
  }

  return false;
}
