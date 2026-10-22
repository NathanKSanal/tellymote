/**
 * Local identity material:
 *  - an RSA client certificate for the Android TV pairing protocol,
 *  - an RSA key in the Android ADB public-key format.
 *
 * Both are generated on first run and stored through the secrets vault. Nothing
 * here is hardcoded and no key material is ever logged.
 */
import forge from 'node-forge';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  constants,
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  X509Certificate,
  type KeyObject,
} from 'node:crypto';

export interface ClientCertificate {
  certPem: string;
  keyPem: string;
  /** SHA-256 of the DER certificate, lowercase hex. */
  fingerprint: string;
  createdAt: number;
}

export function generateClientCertificate(commonName = 'LumaRemote'): ClientCertificate {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomBytes(16).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 20 * 365 * 24 * 60 * 60 * 1000);
  const attrs = [
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: 'LumaRemote' },
    { name: 'countryName', value: 'US' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', clientAuth: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');
  return {
    certPem,
    keyPem,
    fingerprint: createHash('sha256').update(der).digest('hex'),
    createdAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// ADB RSA identity
// ---------------------------------------------------------------------------

export interface AdbIdentity {
  privateKeyPem: string;
  /** base64 blob in the Android RSAPublicKey wire format, without the user suffix. */
  publicKeyBlob: string;
  /** Formatted key as written to ~/.android/adbkey.pub (used only for display/diagnostics). */
  publicKey: string;
  fingerprint: string;
  createdAt: number;
}

const ADB_MODULUS_BYTES = 256;
const ADB_MODULUS_WORDS = 64;

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

function modInverse32(value: bigint): bigint {
  // Newton iteration for the inverse modulo 2^32 (value must be odd).
  let inv = 1n;
  for (let i = 0; i < 5; i++) {
    inv = (inv * (2n - value * inv)) & 0xffffffffn;
  }
  return inv & 0xffffffffn;
}

function bigIntToLittleEndianBytes(value: bigint, length: number): Buffer {
  const out = Buffer.alloc(length);
  let v = value;
  for (let i = 0; i < length; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function generateAdbIdentity(userLabel = 'lumaremote'): AdbIdentity {
  const { privateKey, publicKey: publicKeyObject } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKeyObject.export({ format: 'jwk' }) as { n: string; e: string };
  const n = BigInt('0x' + Buffer.from(jwk.n, 'base64url').toString('hex'));
  const e = BigInt('0x' + Buffer.from(jwk.e, 'base64url').toString('hex'));

  const n0 = n & 0xffffffffn;
  const n0inv = (0x100000000n - modInverse32(n0)) & 0xffffffffn;
  const rr = modPow(1n << 2048n, 2n, n);
  const exponent32 = Number(e) >>> 0;

  const header = Buffer.alloc(8);
  header.writeUInt32LE(ADB_MODULUS_WORDS, 0);
  header.writeUInt32LE(Number(n0inv), 4);
  const exponent = Buffer.alloc(4);
  exponent.writeUInt32LE(exponent32, 0);

  const blob = Buffer.concat([
    header,
    bigIntToLittleEndianBytes(n, ADB_MODULUS_BYTES),
    bigIntToLittleEndianBytes(rr, ADB_MODULUS_BYTES),
    exponent,
  ]);
  const publicKeyBlob = blob.toString('base64');
  const publicKey = `${publicKeyBlob} ${userLabel}`;
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyBlob,
    publicKey,
    fingerprint: createHash('sha256').update(publicKeyBlob).digest('hex'),
    createdAt: Date.now(),
  };
}

/**
 * Reuses the standard Android ADB key in `%USERPROFILE%\.android` when one
 * exists. The TV authorises that key once and then trusts it for every tool
 * that uses it, so the user is not asked again for LumaRemote specifically.
 *
 * The private key is copied into the encrypted vault; it is never written back
 * or logged.
 */
export function readPlatformAdbIdentity(directory = path.join(os.homedir(), '.android')): AdbIdentity | null {
  try {
    const keyPath = path.join(directory, 'adbkey');
    const pubPath = path.join(directory, 'adbkey.pub');
    if (!fs.existsSync(keyPath) || !fs.existsSync(pubPath)) return null;

    const privateKeyPem = fs.readFileSync(keyPath, 'utf8');
    if (!/BEGIN (RSA )?PRIVATE KEY/.test(privateKeyPem)) return null;

    const line = fs.readFileSync(pubPath, 'utf8').trim().split(/\r?\n/)[0] ?? '';
    const [blob, label = 'adb'] = line.split(/\s+/, 2);
    if (!blob) return null;

    const raw = Buffer.from(blob, 'base64');
    if (raw.length < ADB_MODULUS_BYTES * 2 + 12) return null;
    if (raw.readUInt32LE(0) !== ADB_MODULUS_WORDS) return null;

    // Verify the .pub blob belongs to the private key before trusting it.
    const modulus = BigInt('0x' + Buffer.from(raw.subarray(8, 8 + ADB_MODULUS_BYTES)).reverse().toString('hex'));
    const exponent = BigInt(raw.readUInt32LE(8 + ADB_MODULUS_BYTES * 2));
    const jwk = createPublicKey(privateKeyPem).export({ format: 'jwk' }) as { kty: string; n: string; e: string };
    if (jwk.kty !== 'RSA') return null;
    const keyModulus = BigInt('0x' + Buffer.from(jwk.n, 'base64url').toString('hex'));
    const keyExponent = BigInt('0x' + Buffer.from(jwk.e, 'base64url').toString('hex'));
    if (keyModulus !== modulus || keyExponent !== exponent) return null;

    return {
      privateKeyPem,
      publicKeyBlob: blob,
      publicKey: `${blob} ${label}`,
      fingerprint: createHash('sha256').update(blob).digest('hex'),
      createdAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/** Android expects an RSA PKCS#1 v1.5 SHA-1 signature over the AUTH token. */
export function adbSignToken(privateKeyPem: string, token: Buffer): Buffer {
  // Node defaults RSA signatures to PSS; ADB requires PKCS#1 v1.5, and a PSS
  // signature is silently rejected by the TV as an unknown key.
  return sign('sha1', token, { key: privateKeyPem, padding: constants.RSA_PKCS1_PADDING });
}

// ---------------------------------------------------------------------------
// Pairing secret
// ---------------------------------------------------------------------------

function stripLeadingZeros(buf: Buffer): Buffer {
  let i = 0;
  while (i < buf.length - 1 && buf[i] === 0) i++;
  return buf.subarray(i);
}

function exponentBytes(jwkE: string): Buffer {
  const raw = stripLeadingZeros(Buffer.from(jwkE, 'base64url'));
  let hex = raw.toString('hex').replace(/^0+/, '');
  if (hex.length === 0) hex = '0';
  // The protocol hashes the exponent as an even-length hex string ("0" + hex).
  if (hex.length % 2 === 1) hex = '0' + hex;
  return Buffer.from(hex, 'hex');
}

export function certificatePublicParts(cert: { publicKey: KeyObject } | { certPem: string }): {
  modulus: Buffer;
  exponent: Buffer;
} {
  const key = 'publicKey' in cert ? cert.publicKey : new X509Certificate(cert.certPem).publicKey;
  const jwk = key.export({ format: 'jwk' }) as { kty: string; n: string; e: string };
  if (jwk.kty !== 'RSA') throw new Error('Pairing certificate must use RSA');
  return {
    modulus: stripLeadingZeros(Buffer.from(jwk.n, 'base64url')),
    exponent: exponentBytes(jwk.e),
  };
}

export interface PairingSecret {
  secret: Buffer;
  /** True when the code's check byte matches the computed hash (TV will accept it). */
  codePlausible: boolean;
}

/**
 * Implements the Google TV pairing secret:
 *   sha256(clientModulus || clientExponent || serverModulus || serverExponent || code[2..])
 * The first byte of the digest is encoded in the first two hex chars of the code.
 */
export function computePairingSecret(
  clientCertPem: string,
  serverCertDer: Buffer,
  pairingCode: string,
): PairingSecret {
  if (!/^[0-9a-fA-F]{6}$/.test(pairingCode)) {
    throw new Error('Pairing code must be exactly 6 hexadecimal characters');
  }
  const client = certificatePublicParts({ certPem: clientCertPem });
  const server = certificatePublicParts({ publicKey: new X509Certificate(serverCertDer).publicKey });
  const digest = createHash('sha256');
  digest.update(client.modulus);
  digest.update(client.exponent);
  digest.update(server.modulus);
  digest.update(server.exponent);
  digest.update(Buffer.from(pairingCode.slice(2), 'hex'));
  const secret = digest.digest();
  return { secret, codePlausible: secret[0] === parseInt(pairingCode.slice(0, 2), 16) };
}
