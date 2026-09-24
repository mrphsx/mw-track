'use client';

// Чистый UI drag&drop/file-picker для ZIP-загрузки — вынесен из UploadZipLandingDialog (запрос
// пользователя 2026-09-23, второй реальный потребитель — CloakingPrelandingUpload). Не знает,
// что происходит с файлом дальше (валидация расширения, upload) — только сообщает выбранный
// File наружу через onFileSelected.
import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';

export function ZipDropZone({
  file,
  onFileSelected,
  hint = 'Архив должен содержать index.html в корне, до 50MB',
  disabled,
}: {
  file: File | null;
  onFileSelected: (file: File) => void;
  hint?: string;
  disabled?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragOver(false);
        const dropped = e.dataTransfer.files?.[0];
        if (dropped) onFileSelected(dropped);
      }}
      onClick={() => !disabled && fileInputRef.current?.click()}
      className={`border-2 border-dashed rounded-lg p-6 text-center text-sm transition-colors ${
        disabled
          ? 'opacity-50 cursor-not-allowed border-border text-muted-foreground'
          : dragOver
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 cursor-pointer'
            : 'border-border text-muted-foreground hover:border-muted-foreground cursor-pointer'
      }`}
    >
      <UploadCloud className="w-6 h-6 mx-auto mb-2" />
      {file ? file.name : 'Перетащите ZIP сюда или нажмите для выбора'}
      <p className="text-xs text-muted-foreground mt-1">{hint}</p>
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) onFileSelected(picked);
        }}
      />
    </div>
  );
}
