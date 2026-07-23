import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';

const execFileAsync = promisify(execFile);

interface Probe {
  width?: number;
  height?: number;
  durationSeconds: number;
}

@Injectable()
export class VideoProcessingService {
  private readonly logger = new Logger(VideoProcessingService.name);

  // Telegram video_note ("кружок") рендерится кругом только если исходное видео уже
  // квадратное (1:1) — Bot API это никак не проверяет и не сообщает, а просто показывает
  // видео как обычное, без круглой рамки (баг, репорт пользователя 2026-07-17, видео было
  // 1920x1080). Центрируем обрезку по меньшей стороне и заодно обрезаем до 60 сек — второе
  // ограничение самого формата video_note в Telegram.
  //
  // ВАЖНО (правка 2026-07-18, багрепорт "кружок всё ещё квадратный, хотя уже обрезан
  // 1:1"): честно квадратного 1:1 оказалось недостаточно — предыдущая версия сохраняла
  // ИСХОДНОЕ разрешение после обрезки (например, 1080x1080), а собственные видео-кружки
  // Telegram всегда записываются в 384x384 (это ограничение самого формата "video message",
  // конкуренты, судя по всему, тоже приводят видео к этому разрешению перед отправкой, а не
  // просто обрезают в квадрат любого размера). Даунскейлим до 384x384 (не апскейлим — если
  // сторона меньше, оставляем как есть, апскейл только портит качество без пользы).
  // baseline-профиль H.264 — самый широко поддерживаемый на всех клиентах/версиях Telegram
  // для этого конкретного формата сообщений, high (дефолт libx264) поддерживается не везде
  // одинаково для video_note конкретно (хотя как обычное видео воспроизводится где угодно).
  //
  // Если ffprobe/ffmpeg не смогли обработать файл (повреждён, экзотический кодек и т.п.) —
  // отдаём исходный буфер как есть, чтобы не блокировать отправку из-за проблемы обработки.
  private static readonly VIDEO_NOTE_SIZE = 384;

  async ensureSquareVideoNote(buffer: Buffer): Promise<Buffer> {
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `video-note-in-${randomUUID()}.mp4`);
    const outputPath = path.join(tmpDir, `video-note-out-${randomUUID()}.mp4`);

    try {
      await fs.writeFile(inputPath, buffer);
      const probe = await this.probe(inputPath);
      if (!probe.width || !probe.height) return buffer;

      const side = Math.min(probe.width, probe.height);
      const targetSize = Math.min(side, VideoProcessingService.VIDEO_NOTE_SIZE);
      const alreadyRightShape = probe.width === probe.height && side <= VideoProcessingService.VIDEO_NOTE_SIZE;
      const withinDuration = probe.durationSeconds <= 60;
      if (alreadyRightShape && withinDuration) return buffer;

      await execFileAsync('ffmpeg', [
        '-y',
        '-i', inputPath,
        '-vf', `crop=${side}:${side},scale=${targetSize}:${targetSize}`,
        '-t', '60',
        '-c:v', 'libx264',
        '-profile:v', 'baseline',
        '-level', '3.0',
        '-pix_fmt', 'yuv420p',
        '-preset', 'veryfast',
        '-c:a', 'aac',
        '-b:a', '64k',
        '-movflags', '+faststart',
        outputPath,
      ]);

      return await fs.readFile(outputPath);
    } catch (error) {
      this.logger.warn(`video_note crop failed, sending original file as-is: ${(error as Error).message}`);
      return buffer;
    } finally {
      await Promise.all([fs.unlink(inputPath).catch(() => {}), fs.unlink(outputPath).catch(() => {})]);
    }
  }

  // Bot API's sendVideoNote принимает опциональные length/duration ("diameter of the video
  // message") — без них Telegram обязан сам вычислить их из присланных байт. Судя по всему
  // (баг, репорт пользователя 2026-07-17: "видео обрезалось но опять не отправилось как
  // кружок, а как просто квадратное видео" — уже ПОСЛЕ фикса с обрезкой, файл проверен
  // напрямую через ffprobe и подтверждён идеально квадратным 1080x1080/1:1 SAR/DAR),
  // автоопределение у Telegram не всегда срабатывает даже для честно квадратного файла —
  // передаём эти значения явно, вычислив их сами. Скачиваем файл один раз и переиспользуем
  // тот же буфер и для проверки, и для реальной отправки (не два отдельных фетча).
  async fetchAndProbe(url: string): Promise<{ buffer: Buffer; length?: number; durationSeconds: number }> {
    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    const tmpPath = path.join(os.tmpdir(), `video-note-probe-${randomUUID()}.mp4`);
    try {
      await fs.writeFile(tmpPath, buffer);
      const probe = await this.probe(tmpPath);
      return { buffer, length: probe.width, durationSeconds: probe.durationSeconds };
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }
  }

  // Для случаев, где буфер уже есть в памяти (Историй Telegram, запрос пользователя 2026-07-21)
  // и нужны только width/height/duration для DocumentAttributeVideo — без обрезки/перекодирования,
  // в отличие от ensureSquareVideoNote. Публичный вход к приватному probe() ниже.
  async probeBuffer(buffer: Buffer): Promise<Probe> {
    const tmpPath = path.join(os.tmpdir(), `video-probe-${randomUUID()}.mp4`);
    try {
      await fs.writeFile(tmpPath, buffer);
      return await this.probe(tmpPath);
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }
  }

  private async probe(filePath: string): Promise<Probe> {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-show_entries', 'format=duration',
      '-of', 'json',
      filePath,
    ]);
    const parsed = JSON.parse(stdout);
    return {
      width: parsed.streams?.[0]?.width,
      height: parsed.streams?.[0]?.height,
      durationSeconds: Number(parsed.format?.duration) || 0,
    };
  }
}
