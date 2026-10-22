import dgram from 'node:dgram';
import { DNS_CLASS_IN, DNS_TYPE, encodeQuery, parseDns } from './dns';

export interface MdnsService {
  serviceType: string;
  instance: string;
  host: string;
  port: number;
  txt: Record<string, string>;
  addresses: string[];
  lastSeen: number;
}

const MDNS_ADDRESS = '224.0.0.251';
const MDNS_PORT = 5353;

export const TV_SERVICE_TYPES = [
  '_androidtvremote2._tcp.local',
  '_androidtvremote._tcp.local',
  '_googlecast._tcp.local',
  '_viziocast._tcp.local',
  '_airplay._tcp.local',
];

/**
 * Sends mDNS PTR queries and correlates PTR/SRV/TXT/A records.
 *
 * Queries are marked QU (unicast response) so answers arrive on an ephemeral
 * port even when the Windows mDNS service already owns 5353. A best-effort
 * multicast listener is added as well for responders that ignore QU.
 */
export async function discoverMdns(
  serviceTypes: string[] = TV_SERVICE_TYPES,
  timeoutMs = 2600,
): Promise<MdnsService[]> {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const instances = new Map<string, MdnsService>();
  const ptrToService = new Map<string, string>();
  const srvByInstance = new Map<string, { host: string; port: number }>();
  const txtByInstance = new Map<string, Record<string, string>>();
  const addressesByHost = new Map<string, Set<string>>();
  const sourceByInstance = new Map<string, string>();
  let multicastListening = false;

  const handlePacket = (buf: Buffer, rinfo: dgram.RemoteInfo) => {
    let parsed;
    try {
      parsed = parseDns(buf);
    } catch {
      return;
    }
    const records = [...parsed.answers, ...parsed.additionals];
    for (const record of records) {
      if (record.type === DNS_TYPE.PTR && record.ptr) {
        const service = record.name.replace(/\.$/, '');
        const instance = record.ptr.replace(/\.$/, '');
        if (serviceTypes.includes(service)) {
          ptrToService.set(instance, service);
          if (!sourceByInstance.has(instance)) sourceByInstance.set(instance, rinfo.address);
        }
      }
    }
    for (const record of records) {
      const name = record.name.replace(/\.$/, '');
      if (record.type === DNS_TYPE.SRV && record.srv) {
        srvByInstance.set(name, { host: record.srv.target.replace(/\.$/, ''), port: record.srv.port });
        if (!sourceByInstance.has(name)) sourceByInstance.set(name, rinfo.address);
      } else if (record.type === DNS_TYPE.TXT && record.txt) {
        txtByInstance.set(name, record.txt);
      } else if (record.type === DNS_TYPE.A && record.a) {
        if (!addressesByHost.has(name)) addressesByHost.set(name, new Set());
        addressesByHost.get(name)!.add(record.a);
      }
    }
  };

  socket.on('message', (buf, rinfo) => handlePacket(buf, rinfo));

  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, () => {
      try {
        socket.setMulticastTTL(255);
      } catch {
        /* optional */
      }
      resolve();
    });
  }).catch(() => undefined);

  // Optional second socket on 5353 to hear multicast answers.
  const mcast = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  try {
    await new Promise<void>((resolve, reject) => {
      mcast.once('error', reject);
      mcast.bind(MDNS_PORT, () => {
        try {
          mcast.addMembership(MDNS_ADDRESS);
          mcast.setMulticastTTL(255);
          multicastListening = true;
        } catch {
          /* membership unsupported */
        }
        resolve();
      });
    });
    mcast.on('message', (buf, rinfo) => handlePacket(buf, rinfo));
  } catch {
    mcast.close();
  }

  const query = encodeQuery(
    serviceTypes.map((name) => ({ name, type: DNS_TYPE.PTR, cls: DNS_CLASS_IN | 0x8000 })),
  );
  const sendQueries = () => {
    for (let i = 0; i < 2; i++) {
      try {
        socket.send(query, 0, query.length, MDNS_PORT, MDNS_ADDRESS);
        if (multicastListening) mcast.send(query, 0, query.length, MDNS_PORT, MDNS_ADDRESS);
      } catch {
        /* network down */
      }
    }
  };
  sendQueries();
  const repeat = setInterval(sendQueries, 800);

  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
  clearInterval(repeat);
  try {
    socket.close();
  } catch {
    /* noop */
  }
  try {
    mcast.close();
  } catch {
    /* noop */
  }

  for (const [instance, serviceType] of ptrToService) {
    const srv = srvByInstance.get(instance);
    const txt = txtByInstance.get(instance) ?? {};
    const addresses = srv ? [...(addressesByHost.get(srv.host) ?? [])] : [];
    const fallback = sourceByInstance.get(instance);
    if (addresses.length === 0 && fallback) addresses.push(fallback);
    instances.set(instance, {
      serviceType,
      instance,
      host: srv?.host ?? '',
      port: srv?.port ?? 0,
      txt,
      addresses,
      lastSeen: Date.now(),
    });
  }
  // Devices that answered SRV/TXT without a PTR (common for Android TV).
  for (const [instance, srv] of srvByInstance) {
    if (instances.has(instance)) continue;
    const serviceType = [...serviceTypes].find((t) => instance.endsWith(t));
    if (!serviceType) continue;
    const addresses = [...(addressesByHost.get(srv.host) ?? [])];
    const fallback = sourceByInstance.get(instance);
    if (addresses.length === 0 && fallback) addresses.push(fallback);
    instances.set(instance, {
      serviceType,
      instance,
      host: srv.host,
      port: srv.port,
      txt: txtByInstance.get(instance) ?? {},
      addresses,
      lastSeen: Date.now(),
    });
  }

  return [...instances.values()].filter((service) => service.addresses.length > 0);
}
