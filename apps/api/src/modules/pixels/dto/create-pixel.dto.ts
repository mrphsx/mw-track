import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PixelPlatform } from '@prisma/client';

export class CreatePixelDto {
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @IsEnum(PixelPlatform)
  platform: PixelPlatform;

  @IsOptional()
  @IsString()
  label?: string;

  @IsString()
  @IsNotEmpty()
  pixelId: string;

  @IsString()
  @IsNotEmpty()
  accessToken: string;

  // Только Facebook, для отладки CAPI
  @IsOptional()
  @IsString()
  testEventCode?: string;
}
