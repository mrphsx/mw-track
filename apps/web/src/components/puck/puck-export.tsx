'use client';

// Сборка готовой разметки лендинга из состояния редактора: тот же конфиг блоков, режим 'export'
// (плейсхолдеры канала и настоящие ссылки кнопок, см. puck-config.tsx). Результат уходит на сервер
// вместе с data и подставляется в templates/puck/template.html.

import { Render, type Data } from '@puckeditor/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildPuckConfig, type PuckMeta } from './puck-config';
import { withDefaults } from './puck-data';

const exportConfig = buildPuckConfig();
const EXPORT_META: PuckMeta = { mode: 'export' };

export function renderPuckHtml(data: Data): string {
  return renderToStaticMarkup(<Render config={exportConfig} data={withDefaults(data, exportConfig)} metadata={EXPORT_META as Record<string, unknown>} />);
}

export function countSteps(data: Data): number {
  return JSON.stringify(data).split('"type":"Step"').length - 1;
}
