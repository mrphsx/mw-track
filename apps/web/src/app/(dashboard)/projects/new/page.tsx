'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const createProject = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/projects', {
        name,
        description: description || undefined,
      });
      return data;
    },
    onSuccess: (project) => router.push(`/projects/${project.id}`),
    onError: (err) => setError((isAxiosError(err) && err.response?.data?.error?.message) || 'Не удалось создать проект'),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Новый проект</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Основное</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Название проекта</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Описание</Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <p className="text-xs text-gray-500">
            Каналы и пиксели (Facebook, TikTok и т.д.) добавляются после создания проекта — в его настройках.
            Один проект может использовать сразу несколько пикселей разных платформ.
          </p>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <Button disabled={!name || createProject.isPending} onClick={() => createProject.mutate()}>
        {createProject.isPending ? 'Создаём...' : 'Создать проект'}
      </Button>
    </div>
  );
}
