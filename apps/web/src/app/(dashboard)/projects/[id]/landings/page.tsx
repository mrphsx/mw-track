'use client';

import { useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Eye, Plus, Trash2, Upload, UploadCloud } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type LandingType = 'TEMPLATE' | 'CUSTOM' | 'EXTERNAL';
type LandingStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

interface LandingItem {
  id: string;
  name: string;
  type: LandingType;
  status: LandingStatus;
  templateId: string | null;
}

const TYPE_LABEL: Record<LandingType, string> = { TEMPLATE: 'Шаблон', CUSTOM: 'Кастомный', EXTERNAL: 'Внешний' };
const STATUS_LABEL: Record<LandingStatus, string> = { DRAFT: 'Черновик', PUBLISHED: 'Опубликован', ARCHIVED: 'Архив' };
const TEMPLATE_IDS = ['minimal', 'gradient', 'dark'] as const;

export default function LandingsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateId, setTemplateId] = useState<(typeof TEMPLATE_IDS)[number]>('minimal');
  const [templateName, setTemplateName] = useState('');
  const [channelTitle, setChannelTitle] = useState('');
  const [buttonText, setButtonText] = useState('Вступить в канал');
  const [error, setError] = useState('');

  // null — закрыто, 'new' — создаём новый кастомный лендинг, иначе id существующего (ре-загрузка)
  const [uploadTarget, setUploadTarget] = useState<'new' | string | null>(null);
  const [customName, setCustomName] = useState('');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: landings, isLoading } = useQuery({
    queryKey: ['landings', projectId],
    queryFn: async () => (await api.get<LandingItem[]>(`/projects/${projectId}/landings`)).data,
  });

  const resetTemplateForm = () => {
    setShowTemplateModal(false);
    setTemplateId('minimal');
    setTemplateName('');
    setChannelTitle('');
    setButtonText('Вступить в канал');
    setError('');
  };

  const createFromTemplate = useMutation({
    mutationFn: () =>
      api.post(`/projects/${projectId}/landings`, {
        name: templateName,
        templateId,
        channelTitle: channelTitle || undefined,
        buttonText,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['landings', projectId] });
      resetTemplateForm();
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось создать лендинг'),
  });

  const resetUploadForm = () => {
    setUploadTarget(null);
    setCustomName('');
    setZipFile(null);
    setDragOver(false);
    setError('');
  };

  const uploadZip = useMutation({
    mutationFn: () => {
      const formData = new FormData();
      if (!zipFile) throw new Error('Файл не выбран');
      formData.append('file', zipFile);

      if (uploadTarget === 'new') {
        formData.append('name', customName);
        return api.post(`/projects/${projectId}/landings/custom`, formData);
      }
      return api.post(`/landings/${uploadTarget}/upload`, formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['landings', projectId] });
      resetUploadForm();
    },
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось загрузить ZIP'),
  });

  const publish = useMutation({
    mutationFn: (landingId: string) => api.post(`/landings/${landingId}/publish`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['landings', projectId] }),
  });

  const unpublish = useMutation({
    mutationFn: (landingId: string) => api.post(`/landings/${landingId}/unpublish`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['landings', projectId] }),
  });

  const remove = useMutation({
    mutationFn: (landingId: string) => api.delete(`/landings/${landingId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['landings', projectId] }),
  });

  const preview = async (landingId: string) => {
    const res = await api.get(`/landings/${landingId}/preview`, { responseType: 'text' });
    const blob = new Blob([res.data as string], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('Только ZIP-файлы');
      return;
    }
    setError('');
    setZipFile(file);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Лендинги</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setUploadTarget('new')}>
            <UploadCloud className="w-4 h-4 mr-1.5" /> Загрузить ZIP
          </Button>
          <Button onClick={() => setShowTemplateModal(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> Создать из шаблона
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Загрузка...</p>}

      {!isLoading && landings?.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-gray-500">Лендингов пока нет.</CardContent>
        </Card>
      )}

      {!!landings?.length && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {landings.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{TYPE_LABEL[l.type]}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={l.status === 'PUBLISHED' ? 'default' : 'secondary'}>{STATUS_LABEL[l.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => preview(l.id)} title="Предпросмотр">
                          <Eye className="w-4 h-4" />
                        </Button>
                        {l.type === 'CUSTOM' && (
                          <Button size="sm" variant="ghost" onClick={() => setUploadTarget(l.id)} title="Перезалить ZIP">
                            <Upload className="w-4 h-4" />
                          </Button>
                        )}
                        {l.status === 'PUBLISHED' ? (
                          <Button size="sm" variant="outline" onClick={() => unpublish.mutate(l.id)}>
                            Снять с публикации
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => publish.mutate(l.id)}>
                            Опубликовать
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => remove.mutate(l.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={showTemplateModal} onOpenChange={(open) => !open && resetTemplateForm()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Новый лендинг из шаблона</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="landing-name">Название (внутреннее)</Label>
              <Input id="landing-name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="landing-template">Шаблон</Label>
              <Select value={templateId} onValueChange={(v) => v && setTemplateId(v as (typeof TEMPLATE_IDS)[number])}>
                <SelectTrigger id="landing-template">
                  <SelectValue>{(v: string) => v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minimal">Minimal</SelectItem>
                  <SelectItem value="gradient">Gradient</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="landing-title">Название канала</Label>
              <Input id="landing-title" value={channelTitle} onChange={(e) => setChannelTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="landing-button">Текст кнопки</Label>
              <Input id="landing-button" value={buttonText} onChange={(e) => setButtonText(e.target.value)} />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button onClick={() => createFromTemplate.mutate()} disabled={!templateName || createFromTemplate.isPending}>
              {createFromTemplate.isPending ? 'Создаём...' : 'Создать'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={uploadTarget !== null} onOpenChange={(open) => !open && resetUploadForm()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{uploadTarget === 'new' ? 'Загрузить кастомный лендинг' : 'Перезалить ZIP'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {uploadTarget === 'new' && (
              <div className="space-y-1.5">
                <Label htmlFor="custom-name">Название (внутреннее)</Label>
                <Input id="custom-name" value={customName} onChange={(e) => setCustomName(e.target.value)} />
              </div>
            )}

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                pickFile(e.dataTransfer.files?.[0]);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-6 text-center text-sm cursor-pointer transition-colors ${
                dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 text-gray-500 hover:border-gray-400'
              }`}
            >
              <UploadCloud className="w-6 h-6 mx-auto mb-2" />
              {zipFile ? zipFile.name : 'Перетащите ZIP сюда или нажмите для выбора'}
              <p className="text-xs text-gray-400 mt-1">Архив должен содержать index.html в корне, до 50MB</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button
              onClick={() => uploadZip.mutate()}
              disabled={!zipFile || (uploadTarget === 'new' && !customName) || uploadZip.isPending}
            >
              {uploadZip.isPending ? 'Загружаем...' : 'Загрузить'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
