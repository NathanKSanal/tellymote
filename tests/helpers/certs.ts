/**
 * Test-only certificate factory. Mirrors the production identity code but can
 * mint a server-auth certificate for local TLS mock servers.
 */
import forge from 'node-forge';
import { createHash, randomBytes } from 'node:crypto';

export interface TestCertificate {
  certPem: string;
  keyPem: string;
  der: Buffer;
  fingerprint: string;
}

export function makeCertificate(commonName: string, usage: 'client' | 'server' = 'client'): TestCertificate {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomBytes(16).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const attrs = [
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: 'TellyMote tests' },
    { name: 'countryName', value: 'US' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    usage === 'server' ? { name: 'extKeyUsage', serverAuth: true } : { name: 'extKeyUsage', clientAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(cert);
  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');
  return {
    certPem,
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    der,
    fingerprint: createHash('sha256').update(der).digest('hex'),
  };
}
