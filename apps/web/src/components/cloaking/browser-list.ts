// Список известных браузеров (запрос пользователя 2026-09-25, "подсказки при вводе для
// браузера") — тот же набор имён, что распознаёт ua-parser-js (browser.name на бэкенде,
// см. apps/api/.../conditions/user-agent-parsed.evaluators.ts) и что показывает Keitaro в своём
// UI — присланный пользователем список совпадает с этим набором. Статический массив: сами имена
// браузеров не меняются день ото дня, бэкенд-поиск не нужен.
export const BROWSER_NAMES = [
  '360 Browser', '360 Phone Browser', 'ABrowse', 'ANT Fresco', 'ANTGalio', 'Aloha Browser', 'Amaya',
  'Amiga Aweb', 'Amiga Voyager', 'Amigo', 'Android Browser', 'Arora', 'Atomic Web Browser',
  'Avant Browser', 'B-Line', 'Baidu Browser', 'Baidu Spark', 'Beonex', 'BlackBerry Browser', 'Brave',
  'BriskBard', 'BrowseX', 'Bunjalloo', 'Camino', 'Charon', 'Cheshire', 'Chrome', 'Chrome Frame',
  'Chrome Mobile', 'Chrome Mobile iOS', 'ChromePlus', 'Chromium', 'Coast', 'Coc Coc', 'CometBird',
  'Comodo Dragon', 'Conkeror', 'CoolNovo', 'Cyberfox', 'Deepnet Explorer', 'Dillo', 'Dolphin',
  'Dooble', 'Dorado', 'Element Browser', 'Elinks', 'Epic', 'Espial TV Browser', 'Facebook', 'Fennec',
  'Firebird', 'Firefox', 'Firefox Focus', 'Firefox Mobile', 'Fireweb', 'Fireweb Navigator', 'Flock',
  'Fluid', 'GNOME Web', 'Galeon', 'Google Earth', 'HotJava', 'IBrowse', 'IE Mobile', 'IceDragon',
  'Iceape', 'Iceweasel', 'Internet Explorer', 'Iridium', 'Iron', 'Isivioo', 'Jasmine', 'Jig Browser',
  'K-meleon', 'Kapiko', 'Kazehakase', 'Kindle Browser', 'Konqueror', 'Kylo', 'LG Browser', 'Liebao',
  'Links', 'LuaKit', 'Lunascape', 'Lynx', 'MIUI Browser', 'Maxthon', 'Mercury', 'MicroB',
  'Microsoft Edge', 'Midori', 'Mobile Safari', 'Mobile Silk', 'NCSA Mosaic', 'NetFront',
  'NetFront Life', 'NetPositive', 'Netscape', 'Nokia Browser', 'Nokia OSS Browser',
  'Nokia Ovi Browser', 'ONE Browser', 'Obigo', 'Odyssey Web Browser', 'Off By One', 'OmniWeb',
  'Openwave Mobile Browser', 'Opera', 'Opera Mini', 'Opera Mobile', 'Opera Next', 'Oregano',
  'Otter Browser', 'Pale Moon', 'Palm Blazer', 'Palm Pre', 'Palm WebPro', 'Palmscape', 'Phoenix',
  'Polaris', 'Polarity', 'Puffin', 'QQ Browser', 'QupZilla', 'Qutebrowser', 'Rekonq', 'RockMelt',
  'SEMC-Browser', 'Safari', 'Sailfish Browser', 'Samsung Browser', 'SeaMonkey', 'Seraphic Sraf',
  'Shiira', 'Skyfire', 'Sleipnir', 'Snowshoe', 'Sogou Explorer', 'Streamy', 'Sunrise', 'SuperBird',
  'Swiftfox', 'Tizen Browser', 'TweakStyle', 'UC Browser', 'Vision Mobile Browser', 'Vivaldi',
  'Waterfox', 'WeTab Browser', 'WebPositive', 'Xiino', 'Yandex Browser', 'dbrowser', 'iCab',
  'iCab Mobile', 'wOSBrowser',
];

export const BROWSER_OPTIONS = BROWSER_NAMES.map((name) => ({ value: name, label: name }));
