'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

// Смайлики в тексте сообщения (2026-10-26: «а эмодзи в тексте?»). Набор частых эмодзи по группам
// без сторонней библиотеки; последние выбранные — первой вкладкой (в браузере пользователя).
const GROUPS: { id: string; label: string; emoji: string[] }[] = [
  {
    id: 'faces',
    label: '😀',
    emoji: '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈'.split(' '),
  },
  {
    id: 'hands',
    label: '👍',
    emoji: '👍 👎 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐 🖖 👋 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 🫶 👀 🧠 🫡'.split(' '),
  },
  {
    id: 'hearts',
    label: '❤️',
    emoji: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❤️‍🔥 💕 💞 💓 💗 💖 💘 💝 💯 🔥 ✨ ⭐ 🌟 💫 ⚡ 💥 🎉 🎊 🎁 🏆 🥇 👑'.split(' '),
  },
  {
    id: 'money',
    label: '💰',
    emoji: '💰 💵 💶 💸 💳 🪙 💎 📈 📉 📊 🏦 🧾 ✅ ☑️ ✔️ ❌ ❗ ❓ ⚠️ 🚀 🎯 📌 📍 🔔 📣 📢 💬 📞 📱 💻 ⏰ ⏳ 🔒 🔑 🆕 🆓 🔝'.split(' '),
  },
];
const RECENT_KEY = 'chat-recent-emoji';

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 24) : [];
  } catch {
    return [];
  }
}

export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const [recent, setRecent] = useState<string[]>([]);
  const [tab, setTab] = useState('faces');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const r = loadRecent();
    setRecent(r);
    if (r.length) setTab('recent');
  }, []);

  // Закрытие по клику вне окна.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const pick = (e: string) => {
    const next = [e, ...recent.filter((x) => x !== e)].slice(0, 24);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // приватный режим — без «последних»
    }
    onPick(e);
  };

  const tabs = [...(recent.length ? [{ id: 'recent', label: '🕘', emoji: recent }] : []), ...GROUPS];
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];

  return (
    <div ref={ref} className="absolute bottom-full left-0 mb-2 z-30 w-[300px] rounded-xl border border-[#DCE1E8] dark:border-white/10 bg-white dark:bg-[#171F2B] shadow-lg">
      <div className="flex gap-0.5 p-1 border-b border-[#DCE1E8] dark:border-white/10">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn('h-8 w-9 rounded-lg text-base', current.id === t.id ? 'bg-[#1F4E9C]/10 dark:bg-[#7BA9EE]/15' : 'hover:bg-[#F3F5F8] dark:hover:bg-white/5')}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-8 gap-0.5 p-1.5 max-h-56 overflow-y-auto">
        {current.emoji.map((e) => (
          <button
            key={e}
            type="button"
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => pick(e)}
            className="h-8 w-8 rounded-lg text-xl leading-none hover:bg-[#F3F5F8] dark:hover:bg-white/5"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
