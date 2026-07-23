import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class AcceptInviteDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  firstName: string;

  @IsOptional()
  @IsString()
  lastName?: string;
}
