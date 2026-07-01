import { IsIn, IsOptional, IsString } from 'class-validator';

const TEMPLATE_IDS = ['minimal', 'gradient', 'dark'];

export class CreateLandingFromTemplateDto {
  @IsString()
  name: string;

  @IsIn(TEMPLATE_IDS)
  templateId: string;

  @IsOptional() @IsString() primaryColor?: string;
  @IsOptional() @IsString() bgColor?: string;
  @IsOptional() @IsString() gradientFrom?: string;
  @IsOptional() @IsString() gradientTo?: string;
  @IsOptional() @IsString() buttonText?: string;
  @IsOptional() @IsString() channelTitle?: string;
  @IsOptional() @IsString() channelDescription?: string;
  @IsOptional() @IsString() channelAvatar?: string;
  @IsOptional() @IsString() subscribersCount?: string;

  @IsOptional() @IsString() metaTitle?: string;
  @IsOptional() @IsString() metaDescription?: string;
}
