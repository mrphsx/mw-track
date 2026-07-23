import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // рекомендованная длина IV для GCM

// Шифрование секретов, которые нужно хранить в БД (не деривировать на лету, как HD-кошельки
// в billing/) — первый пример: GramJS StringSession личного Telegram-аккаунта
// (запрос пользователя 2026-07-04, Channel.tgSessionEncrypted). Формат хранимой строки:
// "iv:authTag:ciphertext" (всё в hex) — расшифровка не требует ничего, кроме самой строки и ключа.
@Injectable()
export class EncryptionService implements OnModuleInit {
  private key!: Buffer;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    const raw = this.config.get<string>('SESSION_ENCRYPTION_KEY');
    if (!raw) throw new Error('SESSION_ENCRYPTION_KEY не задан (нужен для шифрования секретов в БД, см. .env.prod.example)');
    this.key = Buffer.from(raw, 'base64');
    if (this.key.length !== 32) {
      throw new Error('SESSION_ENCRYPTION_KEY должен быть 32 байта в base64 (сгенерировать: openssl rand -base64 32)');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
  }

  decrypt(stored: string): string {
    const [ivHex, authTagHex, ciphertextHex] = stored.split(':');
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]).toString('utf8');
  }
}
