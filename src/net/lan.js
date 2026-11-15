// Which of this computer's addresses phones should use (server.js, Node only, pure).
//
// The address phones should use. Windows lists virtual adapters (Hyper-V "vEthernet", WSL,
// VirtualBox, VMware, VPNs) next to the Wi-Fi, often first: the QR code then pointed at an address
// the phone can't reach. Rank them: Wi-Fi first, then Ethernet, then anything else private;
// virtual and link-local (169.254) last. HOST=192.168.x.y overrides it.
const VIRTUAL = /vethernet|virtual|vmware|vbox|wsl|hyper-v|docker|loopback|bluetooth|tailscale|zerotier|vpn|tun|tap|utun|bridge|br-|nordlynx|wireguard/i;
export function rankAddresses(ifaces) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces))
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      let score = 0;
      if (/wi-?fi|wlan|wireless|^en0$|^wl/i.test(name)) score += 30;
      else if (/ethernet|^eth|^en\d/i.test(name)) score += 20;
      if (/^(192\.168|10)\./.test(a.address) || /^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) score += 10;
      if (VIRTUAL.test(name)) score -= 50;
      if (a.address.startsWith('169.254.')) score -= 100;
      out.push({ name, address: a.address, score });
    }
  return out.sort((x, y) => y.score - x.score);
}
