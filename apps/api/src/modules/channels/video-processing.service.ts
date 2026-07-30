import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';

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
  // ограничение самого формата video_note в Telegram. Собственные видео-кружки Telegram
  // всегда записаны в 384x384 (ограничение самого формата "video message") — даунскейлим до
  // этого размера (не апскейлим — если сторона меньше, оставляем как есть, апскейл только
  // портит качество без пользы). baseline-профиль H.264 — самый широко поддерживаемый на всех
  // клиентах/версиях Telegram именно для этого формата сообщений (high, дефолт libx264,
  // поддерживается не везде одинаково для video_note конкретно).
  //
  // ПЕРЕПИСАНО 2026-07-25 (баг-репорт пользователя: "кружки редко срабатывают и имеют
  // проблемы, пусть поддерживается любой формат видео и любого разрешения"). Два реальных
  // источника ненадёжности в прежней версии:
  // 1) "Быстрый путь" пропускал перекодирование целиком, если видео УЖЕ было честно квадратным
  //    и короче 60 сек — но "квадратное" не значит "совместимое": видео в HEVC/VP9/AV1/другом
  //    пиксельном формате проходило мимо перекодирования и уходило в Telegram как есть, а
  //    video_note жёстко требует H.264 baseline. Теперь перекодируем ВСЕГДА, без исключений —
  //    единственный способ гарантировать совместимый результат для любого входного формата.
  // 2) Обрезка считалась в Node из "сырых" width/height ffprobe — но эти числа не учитывают
  //    поворот из метаданных (rotate/displaymatrix), которым телефоны маркируют портретные
  //    видео, снятые в приложении с зафиксированной альбомной матрицей сенсора. ffmpeg (начиная
  //    с версии, установленной на этом сервере) сам применяет этот поворот ДО фильтров —
  //    поэтому кадр, который реально видит `-vf`, уже в правильной (дисплейной) ориентации, а
  //    JS-вычисленные из сырых чисел width/height могли не совпадать с ней и обрезать не то.
  //    Фикс — считать обрезку/масштаб выражениями САМОГО ffmpeg (`iw`/`ih`, ширина/высота кадра
  //    В МОМЕНТ фильтра), а не заранее в Node: работает одинаково для любой ориентации и
  //    разрешения без отдельной логики поворота.
  // Если по-настоящему не получилось обработать файл (не видео вообще, битый поток) — кидаем
  // понятную ошибку вместо того, чтобы молча отправить необработанные байты дальше: несовместимый
  // необработанный файл всё равно не отправился бы кружком, только без объяснения причины.
  private static readonly VIDEO_NOTE_SIZE = 384;
  private static readonly VIDEO_NOTE_MAX_DURATION_SECONDS = 60;

  async ensureSquareVideoNote(buffer: Buffer): Promise<Buffer> {
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `video-note-in-${randomUUID()}.input`);
    const outputPath = path.join(tmpDir, `video-note-out-${randomUUID()}.mp4`);

    try {
      await fs.writeFile(inputPath, buffer);

      const probe = await this.probe(inputPath).catch(() => null);
      if (!probe?.width || !probe.height) {
        throw new BadRequestException('Не удалось распознать видео в этом файле — убедитесь, что это видео и файл не повреждён');
      }

      const size = VideoProcessingService.VIDEO_NOTE_SIZE;
      await execFileAsync('ffmpeg', [
        '-y',
        '-i', inputPath,
        '-vf', `crop='min(iw\\,ih)':'min(iw\\,ih)',scale='min(iw\\,${size})':'min(ih\\,${size})',setsar=1`,
        '-t', String(VideoProcessingService.VIDEO_NOTE_MAX_DURATION_SECONDS),
        '-r', '30',
        '-c:v', 'libx264',
        '-profile:v', 'baseline',
        '-level', '3.0',
        '-pix_fmt', 'yuv420p',
        '-preset', 'veryfast',
        '-c:a', 'aac',
        '-b:a', '64k',
        '-ac', '1',
        '-ar', '44100',
        '-movflags', '+faststart',
        '-max_muxing_queue_size', '9999',
        outputPath,
      ]);

      const result = await fs.readFile(outputPath);
      if (!result.length) throw new Error('ffmpeg произвёл пустой файл');
      return result;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`video_note processing failed: ${(error as Error).message}`);
      throw new BadRequestException(
        'Не удалось обработать видео для кружка — попробуйте другой файл (другой формат или короче по длительности)',
      );
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
