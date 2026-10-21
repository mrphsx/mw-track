// Стартовые заготовки визуального редактора: с чего начать новую страницу. Дальше всё меняется в
// редакторе — заготовка лишь заполняет пустой холст осмысленным примером.

import type { Data } from '@puckeditor/core';

let seq = 0;
function item(type: string, props: Record<string, unknown> = {}) {
  seq += 1;
  return { type, props: { id: `${type}-${Date.now().toString(36)}-${seq}`, ...props } };
}

const DARK_ROOT = {
  title: '',
  font: 'system',
  textColor: '#FFFFFF',
  accent: '#2AABEE',
  bgType: 'gradient',
  bgColor: '#0E1621',
  gradFrom: '#17212B',
  gradTo: '#0E1621',
  gradAngle: 180,
  bgImage: '',
  overlayColor: '#000000',
  overlay: 40,
  center: true,
};

// Корень страницы: настройки фона/шрифта из puck-config.tsx (RootProps).
const root = (extra: Record<string, unknown> = {}) => ({ props: { ...DARK_ROOT, ...extra } }) as Data['root'];

function channelCard(): Data {
  return {
    root: root(),
    content: [
      item('Section', {
        fullHeight: true,
        content: [
          item('Card', {
            content: [
              item('Channel', {}),
              item('Text', { text: '<p>Подписывайся, чтобы не пропустить главное</p>', color: '#A6ADB4' }),
              item('Button', { text: 'Вступить в канал', action: 'telegram', pulse: true, shine: true }),
            ],
          }),
        ],
      }),
    ],
  };
}

function ageThenChannel(): Data {
  return {
    root: root({ gradFrom: '#3B2A6E', gradTo: '#7A2E5A', gradAngle: 160 }),
    content: [
      item('Step', {
        name: 'Вопрос',
        content: [
          item('Card', {
            bg: '#28282C',
            bgOpacity: 86,
            glass: true,
            radius: 18,
            maxWidth: 300,
            content: [
              item('Channel', { avatarSize: 72, showTitle: false, showSubs: false }),
              item('Heading', { text: 'Тебе больше 18 лет?', size: 20, level: 'h1' }),
              item('Text', { text: '<p>Подтверди возраст, чтобы продолжить</p>', size: 14, color: '#C7C7CC' }),
              item('Columns', {
                gap: 10,
                stack: false,
                col1: [item('Button', { text: 'Нет', action: 'telegram', variant: 'soft', pulse: false, height: 46 })],
                col2: [item('Button', { text: 'Да', action: 'next', pulse: false, height: 46 })],
              }),
            ],
          }),
        ],
      }),
      item('Step', {
        name: 'Канал',
        content: [
          item('Card', {
            content: [
              item('Channel', { verified: true }),
              item('Text', { text: '<p>Добро пожаловать! Вступай в канал 👇</p>', color: '#A6ADB4' }),
              item('Button', { text: 'Вступить в канал', action: 'telegram', pulse: true }),
            ],
          }),
        ],
      }),
    ],
  };
}

function longRead(): Data {
  return {
    root: root({ bgType: 'color', bgColor: '#FFFFFF', textColor: '#111111', accent: '#E5484D', center: false, font: 'manrope' }),
    content: [
      item('Section', {
        bgType: 'gradient',
        gradFrom: '#111827',
        gradTo: '#1F2937',
        textColor: '#FFFFFF',
        padY: 56,
        content: [
          item('Badge', { text: '🔥 Только сегодня' }),
          item('Heading', { text: 'Большой заголовок, который цепляет', level: 'h1', size: 42, sizeMobile: 30 }),
          item('Text', { text: '<p>Пара предложений о том, почему стоит вступить именно сейчас.</p>', color: '#D1D5DB', size: 18 }),
          item('Button', { text: 'Вступить в канал', action: 'telegram', fullWidth: false, radius: 999, maxWidth: 360 }),
        ],
      }),
      item('Section', {
        padY: 40,
        content: [
          item('Heading', { text: 'Что внутри', size: 28 }),
          item('List', {
            items: [
              { icon: '📈', text: 'Ежедневные разборы' },
              { icon: '💬', text: 'Ответы на вопросы' },
              { icon: '🎁', text: 'Бонусы для подписчиков' },
            ],
            itemBg: '#F3F4F6',
          }),
          item('Timer', { minutes: 30, color: '#E5484D' }),
          item('Button', { text: 'Забрать доступ', action: 'telegram', shine: true }),
        ],
      }),
    ],
  };
}

function blank(): Data {
  return { root: root(), content: [item('Section', { fullHeight: true })] };
}

export const PUCK_STARTERS: { id: string; label: string; description: string; build: () => Data }[] = [
  { id: 'channel', label: 'Карточка канала', description: 'Аватар, название, описание и кнопка', build: channelCard },
  { id: 'age', label: 'Вопрос → канал', description: 'Два шага: вопрос «18+?», затем карточка канала', build: ageThenChannel },
  { id: 'long', label: 'Длинная страница', description: 'Первый экран, список преимуществ, таймер', build: longRead },
  { id: 'blank', label: 'С чистого листа', description: 'Пустая секция на весь экран', build: blank },
];
