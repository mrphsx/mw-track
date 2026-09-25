// Список известных ОС, что распознаёт ua-parser-js (os.name на бэкенде, см.
// apps/api/.../conditions/user-agent-parsed.evaluators.ts) — тот же принцип, что и
// browser-list.ts: конечный, стабильный набор имён, статический массив без бэкенд-поиска.
export const OS_NAMES = [
  'AIX', 'Amiga OS', 'Android', 'Arch', 'Bada', 'BeOS', 'BlackBerry', 'CentOS', 'Chromium OS',
  'Contiki', 'Debian', 'DragonFly', 'Fedora', 'Firefox OS', 'FreeBSD', 'Gentoo', 'GNU', 'Haiku',
  'Hurd', 'iOS', 'Joli', 'Linpus', 'Linux', 'Mac OS', 'Mageia', 'Mandriva', 'MeeGo', 'Minix', 'Mint',
  'Morph OS', 'NetBSD', 'Nintendo', 'OpenBSD', 'OpenVMS', 'OS/2', 'Palm', 'PCLinuxOS', 'Plan9',
  'Playstation', 'QNX', 'RedHat', 'RIM Tablet OS', 'RISC OS', 'Sailfish', 'Series40', 'Slackware',
  'Solaris', 'SUSE', 'Symbian', 'Tizen', 'Ubuntu', 'UNIX', 'VectorLinux', 'WebOS', 'Windows',
  'Windows Phone', 'Windows Mobile', 'Zenwalk',
];

export const OS_OPTIONS = OS_NAMES.map((name) => ({ value: name, label: name }));
