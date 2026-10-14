import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Сворачивание сайдбара до иконок (запрос пользователя 2026-07-31: "поможет освободить много
// места для страниц, в том числе для страницы клиенты") — общий store на оба дерева (Studio +
// классика), т.к. localStorage всё равно строго по origin (mw-track.com/old.mw-track.com не
// делят его между собой), дублировать store ради этого не нужно, см. тот же принцип у
// auth.store.ts.
// Вид списка лендингов в Studio (запрос пользователя 2026-10-14: "после переключения на
// карточки, даже после обновления страницы у пользователя должны остаться карточки") — по
// умолчанию список, выбор живёт в том же persist-хранилище, что и свёрнутый сайдбар.
export type LandingsView = 'list' | 'cards';

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  landingsView: LandingsView;
  setLandingsView: (view: LandingsView) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      landingsView: 'list',
      setLandingsView: (landingsView) => set({ landingsView }),
    }),
    { name: 'mwtrack-ui' },
  ),
);
