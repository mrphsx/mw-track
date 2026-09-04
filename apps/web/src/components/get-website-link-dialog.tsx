'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { LinkPixel, buildWebsiteTrackedLink } from '@/lib/landings';
import { useAuthStore } from '@/store/auth.store';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ALL_PIXELS, PixelLinkFields, resolveLinkBuyerId } from '@/components/get-link-dialog';

export interface GetWebsiteLinkProject {
  id: string;
  name: string;
}

// Ссылка для проекта типа "Обычный сайт" (запрос пользователя 2026-09-03: "сайт уже на домене
// стоит и его можно пускать без промежуточных лэндингов") — зеркалит GetLinkDialog (та же форма
// выбора пикселя, тот же PixelLinkFields), но без Лендинга/DomainPath вообще: destination —
// сразу Channel.websiteUrl, а не домен+путь, которые сервер должен был бы отрендерить сам.
export function GetWebsiteLinkDialog({
  project,
  onClose,
}: {
  project: GetWebsiteLinkProject | null;
  onClose: () => void;
}) {
  const [pixelSelection, setPixelSelection] = useState(ALL_PIXELS);
  const currentUser = useAuthStore((s) => s.user);

  const { data: fullProject } = useQuery({
    queryKey: ['project', project?.id],
    queryFn: () => api.get(`/projects/${project!.id}`).then((r) => r.data),
    enabled: !!project,
  });

  if (!project) return null;

  const pixels: LinkPixel[] = (fullProject?.pixels ?? []).filter((p: LinkPixel) => p.isActive);
  const selectedPixel = pixels.find((p) => p.id === pixelSelection) ?? null;
  const buyerId = resolveLinkBuyerId(currentUser);
  const websiteUrl: string | null = fullProject?.channel?.websiteUrl ?? null;
  const link = websiteUrl
    ? buildWebsiteTrackedLink(websiteUrl, selectedPixel, fullProject?.linkParamMap, buyerId)
    : null;

  return (
    <Dialog open={!!project} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ссылка для «{project.name}»</DialogTitle>
        </DialogHeader>

        {!websiteUrl ? (
          <p className="text-sm text-muted-foreground">
            Сначала укажите и подтвердите адрес сайта в Настройках → Интеграция.
          </p>
        ) : (
          <PixelLinkFields pixels={pixels} pixelSelection={pixelSelection} onPixelChange={setPixelSelection} link={link} />
        )}
      </DialogContent>
    </Dialog>
  );
}
