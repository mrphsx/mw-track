import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Сворачивание сайдбара до иконок (запрос пользователя 2026-07-31: "поможет освободить много
// места для страниц, в том числе для страницы клиенты") — общий store на оба дерева (Studio +
// классика), т.к. localStorage всё равно строго по origin (mw-track.com/old.mw-track.com не
// делят его между собой), дублировать store ради этого не нужно, см. тот же принцип у
// auth.store.ts.
interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: 'mwtrack-ui' },
  ),
);
