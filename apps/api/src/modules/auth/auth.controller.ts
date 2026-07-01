import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @UseGuards(AuthGuard('jwt-refresh'))
  @Post('refresh')
  refresh(@Body() _dto: RefreshDto, @CurrentUser() user: { userId: string; rawRefreshToken: string }) {
    return this.authService.refresh(user.userId, user.rawRefreshToken);
  }

  @Post('logout')
  logout(@CurrentUser() user: { userId: string }, @Body() dto: LogoutDto) {
    return this.authService.logout(user.userId, dto.refreshToken);
  }

  @Get('me')
  me(@CurrentUser() user: { userId: string }) {
    return this.authService.me(user.userId);
  }
}
