import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../types/jwt-payload.interface';

// Refresh-токен приходит не в Authorization заголовке, а в теле запроса
// POST /auth/refresh { refreshToken }
@Injectable()
export class RefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromBodyField('refreshToken'),
      secretOrKey: config.get<string>('JWT_REFRESH_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload) {
    return {
      userId: payload.sub,
      companyId: payload.companyId,
      role: payload.role,
      // сырой токен нужен AuthService для bcrypt.compare с хешем в БД и для ротации
      rawRefreshToken: (req.body as { refreshToken: string }).refreshToken,
    };
  }
}
