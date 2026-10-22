import { constants, createHash, createPublicKey, publicDecrypt, verify, X509Certificate } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  adbSignToken,
  certificatePublicParts,
  computePairingSecret,
  generateAdbIdentity,
  generateClientCertificate,
  readPlatformAdbIdentity,
  type AdbIdentity,
  type ClientCertificate,
} from '../electron/core/security/identity';
import { makeCertificate, type TestCertificate } from './helpers/certs';

let client: ClientCertificate;
let server: TestCertificate;
let adb: AdbIdentity;

beforeAll(() => {
  client = generateClientCertificate();
  server = makeCertificate('Mock TV', 'server');
  adb = generateAdbIdentity('tellymote');
});

describe('client pairing certificate', () => {
  it('produces a parseable self-signed certificate with a matching fingerprint', () => {
    const parsed = new X509Certificate(client.certPem);
    expect(parsed.subject).toContain('CN=TellyMote');
    expect(parsed.verify(parsed.publicKey)).toBe(true);
    expect(client.fingerprint).toBe(createHash('sha256').update(parsed.raw).digest('hex'));
    expect(client.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.now() - client.createdAt).toBeLessThan(60_000);
  });

  it('extracts the minimal big-endian RSA public exponent', () => {
    const parts = certificatePublicParts({ certPem: client.certPem });
    expect(parts.modulus.length).toBeGreaterThanOrEqual(255);
    expect(parts.exponent).toEqual(Buffer.from([0x01, 0x00, 0x01])); // 65537
  });
});

describe('pairing secret', () => {
  it('hashes client modulus, client exponent, server modulus, server exponent and code tail', () => {
    const result = computePairingSecret(client.certPem, server.der, '00abcd');
    const clientParts = certificatePublicParts({ certPem: client.certPem });
    const serverParts = certificatePublicParts({ publicKey: new X509Certificate(server.der).publicKey });
    const expected = createHash('sha256')
      .update(clientParts.modulus)
      .update(clientParts.exponent)
      .update(serverParts.modulus)
      .update(serverParts.exponent)
      .update(Buffer.from('abcd', 'hex'))
      .digest();
    expect(result.secret).toEqual(expected);
    expect(result.secret).toHaveLength(32);
  });

  it('accepts a code whose first byte matches the digest prefix', () => {
    const base = computePairingSecret(client.certPem, server.der, '00abcd');
    const goodCode = `${base.secret[0].toString(16).padStart(2, '0')}abcd`;
    const good = computePairingSecret(client.certPem, server.der, goodCode);
    expect(good.codePlausible).toBe(true);
    // The checksum bytes are not part of the hash, so the secret is unchanged.
    expect(good.secret).toEqual(base.secret);
  });

  it('rejects a code with the wrong checksum prefix', () => {
    const base = computePairingSecret(client.certPem, server.der, '00abcd');
    const badPrefix = ((base.secret[0] + 1) % 256).toString(16).padStart(2, '0');
    const bad = computePairingSecret(client.certPem, server.der, `${badPrefix}abcd`);
    expect(bad.codePlausible).toBe(false);
  });

  it('is case-insensitive for hex digits', () => {
    const lower = computePairingSecret(client.certPem, server.der, '00abcd');
    const upper = computePairingSecret(client.certPem, server.der, '00ABCD');
    expect(upper.secret).toEqual(lower.secret);
    expect(upper.codePlausible).toBe(lower.codePlausible);
  });

  it('rejects codes that are not six hexadecimal characters', () => {
    expect(() => computePairingSecret(client.certPem, server.der, '12345')).toThrow(/6 hexadecimal/);
    expect(() => computePairingSecret(client.certPem, server.der, '1234567')).toThrow(/6 hexadecimal/);
    expect(() => computePairingSecret(client.certPem, server.der, 'zzzzzz')).toThrow(/6 hexadecimal/);
  });
});

describe('ADB RSA identity', () => {
  it('emits the Android RSAPublicKey wire layout', () => {
    const blob = Buffer.from(adb.publicKeyBlob, 'base64');
    expect(blob).toHaveLength(8 + 256 + 256 + 4);
    expect(blob.readUInt32LE(0)).toBe(64); // modulus length in 32-bit words
    expect(blob.readUInt32LE(520)).toBe(65537); // e, little-endian
    expect(adb.publicKey).toBe(`${adb.publicKeyBlob} tellymote`);
    expect(adb.fingerprint).toBe(createHash('sha256').update(adb.publicKeyBlob).digest('hex'));
  });

  it('encodes the same RSA modulus as the private key', () => {
    const blob = Buffer.from(adb.publicKeyBlob, 'base64');
    const jwk = createPublicKey(adb.privateKeyPem).export({ format: 'jwk' }) as { n: string };
    const modulus = Buffer.from(jwk.n, 'base64url');
    expect(Buffer.from(blob.subarray(8, 264)).reverse()).toEqual(modulus);
  });

  it('signs the ADB auth token with PKCS#1 v1.5 SHA-1', () => {
    const token = randomBytes(20);
    const signature = adbSignToken(adb.privateKeyPem, token);
    const publicKey = createPublicKey(adb.privateKeyPem);

    // A signature is the private-key exponentiation of the padded encoding, so
    // the padding is only visible if the block is recovered with the public key.
    const recovered = publicDecrypt({ key: publicKey, padding: constants.RSA_NO_PADDING }, signature);
    expect(recovered.subarray(0, 2)).toEqual(Buffer.from([0x00, 0x01]));
    expect(recovered.subarray(2, 10)).toEqual(Buffer.alloc(8, 0xff));

    expect(verify('sha1', token, publicKey, signature)).toBe(true);
    expect(verify('sha1', randomBytes(20), publicKey, signature)).toBe(false);
    // PSS must not verify: Android's adbd only accepts v1.5 signatures.
    expect(
      verify(
        'sha1',
        token,
        { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 20 },
        signature,
      ),
    ).toBe(false);
  });
});

describe('standard Android ADB key reuse', () => {
  it('imports the user-profile adbkey and matches its public blob', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-adbkey-'));
    try {
      const generated = generateAdbIdentity('platform-tools');
      fs.writeFileSync(path.join(dir, 'adbkey'), generated.privateKeyPem);
      fs.writeFileSync(path.join(dir, 'adbkey.pub'), generated.publicKey + '\n');

      const imported = readPlatformAdbIdentity(dir);
      expect(imported).not.toBeNull();
      expect(imported?.publicKeyBlob).toBe(generated.publicKeyBlob);
      expect(imported?.fingerprint).toBe(generated.fingerprint);
      // The private key must actually sign for the imported public key.
      const token = randomBytes(20);
      const signature = adbSignToken(imported!.privateKeyPem, token);
      expect(verify('sha1', token, createPublicKey(imported!.privateKeyPem), signature)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a public blob that does not belong to the private key', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-adbkey-'));
    try {
      const first = generateAdbIdentity('first');
      const second = generateAdbIdentity('second');
      fs.writeFileSync(path.join(dir, 'adbkey'), first.privateKeyPem);
      fs.writeFileSync(path.join(dir, 'adbkey.pub'), second.publicKey + '\n');
      expect(readPlatformAdbIdentity(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when no standard key exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-adbkey-'));
    try {
      expect(readPlatformAdbIdentity(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
