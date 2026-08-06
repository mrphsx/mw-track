'use client';

import { StudioPushComposer } from '../../push-composer';

// Company-wide создание рассылки (запрос пользователя 2026-08-04, синяя кнопка "Создать
// рассылку" на странице "Рассылки") — без предвыбранного проекта, в отличие от
// projects/[id]/pushes/new, который предвыбирает проект, с которого перешли.
export default function StudioNewCompanyPushPage() {
  return <StudioPushComposer initialProjectIds={[]} />;
}
