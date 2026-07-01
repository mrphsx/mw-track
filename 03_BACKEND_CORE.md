# 03 — Backend Core: Auth и Мультитенантность

## Задача для Claude Code
Реализуй модули auth, companies, users с полной мультитенантностью.

## main.ts

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.use(helmet());
  app.use(compression());
  
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
  });
  
  app.setGlobalPrefix('api/v1');
  
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }));
  
  // Swagger документация
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('TrafficCRM API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }
  
  await app.listen(process.env.PORT || 3001);
}
bootstrap();
```

## Auth Module

### JWT Стратегия
```typescript
// modules/auth/strategies/jwt.strategy.ts
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    // payload содержит: userId, companyId, role
    return {
      userId: payload.sub,
      companyId: payload.companyId,
      role: payload.role,
    };
  }
}
```

### Auth Service
```typescript
// modules/auth/auth.service.ts
@Injectable()
export class AuthService {
  
  async register(dto: RegisterDto) {
    // 1. Проверить что email не занят
    // 2. Создать Company
    // 3. Создать User с ролью OWNER
    // 4. Выдать токены
    
    const company = await this.prisma.company.create({
      data: {
        name: dto.companyName,
        slug: await this.generateUniqueSlug(dto.companyName),
        // Дефолтный план TRIAL
        plan: 'TRIAL',
        maxProjects: 1,
        maxClients: 1000,
        maxPushesPerMonth: 5,
        planExpiresAt: addDays(new Date(), 7), // 7 дней триала
      }
    });
    
    const user = await this.prisma.user.create({
      data: {
        companyId: company.id,
        email: dto.email,
        passwordHash: await bcrypt.hash(dto.password, 12),
        firstName: dto.firstName,
        role: 'OWNER',
      }
    });
    
    return this.issueTokens(user);
  }
  
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { company: true }
    });
    
    if (!user || !await bcrypt.compare(dto.password, user.passwordHash)) {
      throw new UnauthorizedException('Неверный email или пароль');
    }
    
    if (!user.isActive) {
      throw new ForbiddenException('Аккаунт заблокирован');
    }
    
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });
    
    return this.issueTokens(user);
  }
  
  async refresh(refreshToken: string) {
    // Верифицировать refresh token
    // Найти в БД (не истёк, не отозван)
    // Выдать новую пару токенов
    // Старый refresh token инвалидировать (rotation)
  }
  
  private async issueTokens(user: User & { company?: Company }) {
    const payload: JwtPayload = {
      sub: user.id,
      companyId: user.companyId,
      role: user.role,
    };
    
    const accessToken = this.jwt.sign(payload, { expiresIn: '15m' });
    const refreshToken = this.jwt.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: '30d',
    });
    
    // Сохранить refresh token в БД
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: await bcrypt.hash(refreshToken, 10),
        expiresAt: addDays(new Date(), 30),
      }
    });
    
    return { accessToken, refreshToken, user: this.sanitizeUser(user) };
  }
}
```

### Auth Controller
```typescript
// POST /api/v1/auth/register
// POST /api/v1/auth/login
// POST /api/v1/auth/refresh
// POST /api/v1/auth/logout
// GET  /api/v1/auth/me
```

## Мультитенантность — ОБЯЗАТЕЛЬНО В КАЖДОМ ЗАПРОСЕ

### Company Context через AsyncLocalStorage

```typescript
// common/context/company.context.ts
import { AsyncLocalStorage } from 'async_hooks';

export interface CompanyContext {
  companyId: string;
  userId: string;
  role: UserRole;
}

export const companyStorage = new AsyncLocalStorage<CompanyContext>();

// Хелпер для получения контекста
export function getCompanyContext(): CompanyContext {
  const ctx = companyStorage.getStore();
  if (!ctx) throw new Error('Company context not initialized');
  return ctx;
}
```

### Middleware для установки контекста
```typescript
// common/middleware/company-context.middleware.ts
@Injectable()
export class CompanyContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // JWT уже верифицирован guard'ом
    // req.user установлен JwtStrategy
    if (req.user) {
      companyStorage.run(
        {
          companyId: req.user.companyId,
          userId: req.user.userId,
          role: req.user.role,
        },
        () => next()
      );
    } else {
      next();
    }
  }
}
```

### Расширенный PrismaService с авторизацией

```typescript
// prisma/prisma.service.ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
    
    // Middleware для автоматической фильтрации по company_id
    // Применяется ко всем запросам к моделям с companyId
    this.$use(async (params, next) => {
      const modelsWithCompany = [
        'Project', 'Domain', 'Landing', 'Client',
        'Push', 'Purchase', 'TrackingEvent'
      ];
      
      if (modelsWithCompany.includes(params.model)) {
        const ctx = companyStorage.getStore();
        
        if (ctx) {
          // Для операций чтения — добавить фильтр
          if (['findFirst', 'findMany', 'count', 'aggregate'].includes(params.action)) {
            params.args.where = {
              ...params.args.where,
              companyId: ctx.companyId,
              deletedAt: null,  // soft delete
            };
          }
          
          // Для создания — добавить companyId
          if (params.action === 'create') {
            params.args.data = {
              ...params.args.data,
              companyId: ctx.companyId,
            };
          }
          
          // Для обновления — проверить владельца
          if (['update', 'delete'].includes(params.action)) {
            params.args.where = {
              ...params.args.where,
              companyId: ctx.companyId,
            };
          }
        }
      }
      
      return next(params);
    });
  }
}
```

## Guards

### Roles Guard
```typescript
// common/guards/roles.guard.ts
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<UserRole[]>('roles', context.getHandler());
    if (!requiredRoles) return true;
    
    const { user } = context.switchToHttp().getRequest();
    
    const roleHierarchy = {
      SUPER_ADMIN: 4,
      OWNER: 3,
      ADMIN: 2,
      ADVERTISER: 1,
    };
    
    const userLevel = roleHierarchy[user.role] || 0;
    const requiredLevel = Math.min(...requiredRoles.map(r => roleHierarchy[r] || 0));
    
    return userLevel >= requiredLevel;
  }
}
```

### Subscription Guard (проверка лимитов)
```typescript
// common/guards/subscription.guard.ts
@Injectable()
export class SubscriptionGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limit = this.reflector.get<string>('subscriptionLimit', context.getHandler());
    if (!limit) return true;
    
    const { user } = context.switchToHttp().getRequest();
    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId }
    });
    
    // Проверить истёк ли план
    if (company.planExpiresAt && company.planExpiresAt < new Date()) {
      throw new ForbiddenException('Подписка истекла. Пожалуйста, продлите план.');
    }
    
    // Проверить лимиты
    switch (limit) {
      case 'projects':
        if (company.currentProjects >= company.maxProjects) {
          throw new ForbiddenException(`Достигнут лимит проектов (${company.maxProjects}) для вашего плана`);
        }
        break;
      case 'clients':
        if (company.currentClients >= company.maxClients) {
          throw new ForbiddenException(`Достигнут лимит клиентов (${company.maxClients})`);
        }
        break;
      case 'pushes':
        if (company.pushesThisMonth >= company.maxPushesPerMonth) {
          throw new ForbiddenException(`Достигнут лимит рассылок в этом месяце`);
        }
        break;
    }
    
    return true;
  }
}
```

## Decorators

```typescript
// @Roles(UserRole.OWNER, UserRole.ADMIN)
export const Roles = (...roles: UserRole[]) => SetMetadata('roles', roles);

// @SubscriptionLimit('projects')
export const SubscriptionLimit = (limit: string) => SetMetadata('subscriptionLimit', limit);

// @Public() — bypass JWT
export const Public = () => SetMetadata('isPublic', true);

// @Company() — получить company из request
export const Company = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user?.companyId;
  }
);

// @CurrentUser()
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    return ctx.switchToHttp().getRequest().user;
  }
);
```

## Users Module

### Users Controller endpoints:
```
GET    /api/v1/users              — список (ADMIN+)
POST   /api/v1/users/invite       — пригласить сотрудника (OWNER/ADMIN)
PATCH  /api/v1/users/:id          — обновить роль/данные
DELETE /api/v1/users/:id          — деактивировать
POST   /api/v1/users/:id/projects — назначить проекты рекламщику
```

### Invite Flow:
1. OWNER создаёт пользователя с временным паролем
2. Система отправляет email (или показывает ссылку)
3. Пользователь меняет пароль при первом входе

## App Module — итоговая сборка

```typescript
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({ connection: { url: process.env.REDIS_URL } }),
    
    // Feature modules
    AuthModule,
    CompaniesModule,
    UsersModule,
    ProjectsModule,
    DomainsModule,
    ChannelsModule,
    LandingsModule,
    TrackingModule,
    ClientsModule,
    PushesModule,
    PurchasesModule,
    AnalyticsModule,
    BillingModule,
    WebhooksModule,
    StorageModule,
  ],
  providers: [
    PrismaService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },   // глобально
    { provide: APP_GUARD, useClass: RolesGuard },      // глобально
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CompanyContextMiddleware)
      .forRoutes('*');
  }
}
```
