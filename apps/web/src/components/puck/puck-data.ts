// Дополнение данных страницы значениями по умолчанию из конфига. Puck сам подставляет их только
// при вставке блока в редакторе, а Render — нигде. Без этого заготовки и страницы, сохранённые до
// появления нового поля, рендерились бы с undefined в настройках.

import type { Config, Data } from '@puckeditor/core';

type Item = { type: string; props: Record<string, unknown> };

function fillItem(item: Item, config: Config): Item {
  const component = config.components[item.type];
  if (!component) return item;
  const props: Record<string, unknown> = { ...(component.defaultProps ?? {}), ...item.props };
  for (const [key, field] of Object.entries(component.fields ?? {})) {
    if ((field as { type?: string }).type === 'slot' && Array.isArray(props[key])) {
      props[key] = (props[key] as Item[]).map((child) => fillItem(child, config));
    }
  }
  return { ...item, props };
}

export function withDefaults(data: Partial<Data>, config: Config): Data {
  const rootProps = (data.root as { props?: Record<string, unknown> } | undefined)?.props ?? {};
  return {
    ...data,
    root: { ...(data.root ?? {}), props: { ...(config.root?.defaultProps ?? {}), ...rootProps } },
    content: ((data.content ?? []) as Item[]).map((item) => fillItem(item, config)),
  } as Data;
}
