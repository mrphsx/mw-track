import * as ipaddr from 'ipaddr.js';

// Общий CIDR/точное-совпадение матчинг для условия IP и эвристики BOT — принимает как голый IP
// ("1.2.3.4"), так и CIDR ("1.2.3.0/24"), IPv4 и IPv6 в одном списке (объединяет Keitaro'вские
// отдельные типы "IP" и "IPv6" в один). Молча пропускает нераспознаваемые записи вместо падения —
// правило с опечаткой в одном диапазоне не должно валить оценку всего условия.
export function ipMatchesAnyRange(ip: string, ranges: string[]): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.process(ip);
  } catch {
    return false;
  }

  for (const range of ranges) {
    try {
      if (range.includes('/')) {
        const [rangeAddr, prefixLength] = ipaddr.parseCIDR(range);
        if (rangeAddr.kind() !== addr.kind()) continue;
        if (addr.match([rangeAddr, prefixLength] as [ipaddr.IPv4, number] | [ipaddr.IPv6, number])) return true;
      } else {
        const rangeAddr = ipaddr.process(range);
        if (rangeAddr.kind() !== addr.kind()) continue;
        if (rangeAddr.toString() === addr.toString()) return true;
      }
    } catch {
      // некорректная запись диапазона — пропускаем, не валим всё условие
    }
  }
  return false;
}
