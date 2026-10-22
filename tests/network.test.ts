import { describe, expect, it } from 'vitest';
import { isPrivateIPv4, rankInterfaces, type LocalInterface } from '../electron/core/discovery/network';

function iface(name: string, address = '192.168.0.101'): LocalInterface {
  return {
    name,
    address,
    mac: 'aa:bb:cc:dd:ee:ff',
    prefixLength: 24,
    subnet: '192.168.0.0',
    isPrivate: true,
  };
}

describe('private IPv4 detection', () => {
  it('accepts RFC1918 ranges only', () => {
    for (const address of ['10.0.0.1', '10.255.255.254', '172.16.0.1', '172.31.255.254', '192.168.0.1', '192.168.255.254']) {
      expect(isPrivateIPv4(address), address).toBe(true);
    }
    for (const address of [
      '172.15.0.1',
      '172.32.0.1',
      '192.169.0.1',
      '8.8.8.8',
      '169.254.10.1',
      '100.64.0.1',
      '1.1.1.1',
      'nope',
      '192.168.0',
      '192.168.0.256',
      '192.168.0.-1',
      '192.168.0.1.2',
    ]) {
      expect(isPrivateIPv4(address), address).toBe(false);
    }
  });
});

describe('network adapter ranking', () => {
  it('puts real Wi-Fi before Ethernet, unknown adapters and virtual switches', () => {
    const ranked = rankInterfaces([
      iface('vEthernet (Default Switch)'),
      iface('Ethernet 2'),
      iface('Some VPN Tunnel'),
      iface('Wi-Fi'),
      iface('Ethernet'),
      iface('Local Area Connection'),
    ]);
    expect(ranked.map((i) => i.name)).toEqual([
      'Wi-Fi',
      'Ethernet',
      'Ethernet 2',
      'Local Area Connection',
      'Some VPN Tunnel',
      'vEthernet (Default Switch)',
    ]);
  });

  it('demotes a virtual adapter even when its name contains "ethernet"', () => {
    const ranked = rankInterfaces([iface('vEthernet (Default Switch)'), iface('Ethernet')]);
    expect(ranked[0].name).toBe('Ethernet');
  });

  it('demotes Docker, WSL, Tailscale, WireGuard and VMware adapters', () => {
    const virtual = [
      'Docker Desktop',
      'WSL (Hyper-V firewall)',
      'Tailscale',
      'WireGuard Tunnel',
      'VMware Network Adapter VMnet1',
      'Bluetooth Network Connection',
    ];
    const ranked = rankInterfaces([...virtual.map((name) => iface(name)), iface('Wi-Fi')]);
    expect(ranked[0].name).toBe('Wi-Fi');
    expect(ranked.slice(1).every((i) => virtual.includes(i.name))).toBe(true);
  });

  it('breaks ties alphabetically and does not mutate the input', () => {
    const input = [iface('Wi-Fi 2'), iface('Wi-Fi 1')];
    const snapshot = input.map((i) => i.name);
    const ranked = rankInterfaces(input);
    expect(ranked.map((i) => i.name)).toEqual(['Wi-Fi 1', 'Wi-Fi 2']);
    expect(input.map((i) => i.name)).toEqual(snapshot);
    expect(ranked).not.toBe(input);
  });

  it('keeps every interface, including duplicates by name', () => {
    const input = [iface('Wi-Fi', '192.168.0.10'), iface('Wi-Fi', '192.168.0.11')];
    expect(rankInterfaces(input)).toHaveLength(2);
  });
});
