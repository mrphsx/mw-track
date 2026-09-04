import * as dns from 'dns/promises';
import * as net from 'net';

// Защита от SSRF для любого будущего "сходи по адресу, который ввёл сам пользователь-арендатор"
// сценария (первый живой случай — WebsiteProvider.initialize(), проверка track.js на сайте
// клиента) — реального готового утиля для этого в кодовой базе не было, каждый существующий
// исходящий запрос (Telegram/Facebook/TikTok) идёт на адрес, который контролируем МЫ, не
// клиент, поэтому не нуждался в этой проверке. Здесь адрес вводит клиент — без неё сервер стал
// бы прокси для сканирования внутренней сети/облачного metadata-эндпоинта (169.254.169.254 —
// классическая цель SSRF на AWS/GCP/Azure).
const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
  ['127.0.0.0', 8],
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['169.254.0.0', 16], // включает 169.254.169.254 — облачный metadata-эндпоинт
  ['0.0.0.0', 8],
];

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  return BLOCKED_IPV4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipInt & mask) === (ipv4ToInt(base) & mask);
  });
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

export function isBlockedIp(ip: string): boolean {
  return net.isIPv6(ip) ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

// Бросает, если хост резолвится (хотя бы одним из адресов) в приватный/локальный диапазон —
// вызывать ДО каждого реального запроса, включая после каждого редиректа (DNS может
// резолвиться по-другому между проверкой и самим запросом — accepted TOCTOU-риск того же
// порядка, что и у любого SSRF-фильтра без полного контроля над сетевым стеком).
export async function assertPublicHost(hostname: string): Promise<void> {
  let addresses: string[];
  try {
    addresses = (await dns.lookup(hostname, { all: true })).map((a) => a.address);
  } catch {
    throw new Error('Не удалось определить адрес хоста');
  }
  if (addresses.length === 0 || addresses.some(isBlockedIp)) {
    throw new Error('Адрес недоступен для проверки');
  }
}
