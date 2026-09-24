import { IsString, IsUrl } from 'class-validator';

// Лендинг клиента на его собственном сервере/домене (запрос пользователя 2026-09-07) —
// намеренно НЕ наследует LandingBehaviorDto: autoRedirect/cloakingEnabled — поведение рендера
// (LandingRendererService), который для EXTERNAL никогда не срабатывает (мы не рендерим эту
// страницу сами), эти поля здесь просто не имеют смысла.
export class CreateExternalLandingDto {
  @IsString()
  name: string;

  @IsUrl({ require_protocol: true })
  externalUrl: string;
}
