import { Controller, Get, Param, Query } from '@nestjs/common';
import { Company } from '../../common/decorators/company.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AudienceService } from './audience.service';

// Без @Roles() — видимость сама по себе ограничена набором доступных проектов
// (см. AudienceService.getAccessibleProjectIds), тот же принцип, что у /landings
// company-wide и /pushes: Buyer/Operator видят пересечения только между своими проектами.
@Controller('audience')
export class AudienceController {
  constructor(private audienceService: AudienceService) {}

  @Get('overlap')
  getOverlapMatrix(@Company() companyId: string, @CurrentUser() user: AuthUser) {
    return this.audienceService.getOverlapMatrix(companyId, user.userId, user.role);
  }

  @Get('overlap/:projectAId/:projectBId')
  getOverlapDetail(
    @Param('projectAId') projectAId: string,
    @Param('projectBId') projectBId: string,
    @Company() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.audienceService.getOverlapDetail(
      companyId,
      user.userId,
      user.role,
      projectAId,
      projectBId,
      Number(page) || 1,
      Math.min(Number(limit) || 20, 100),
      search,
    );
  }
}
