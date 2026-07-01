import { SetMetadata } from '@nestjs/common';

export const SUBSCRIPTION_LIMIT_KEY = 'subscriptionLimit';

// @SubscriptionLimit('projects')
export const SubscriptionLimit = (limit: string) => SetMetadata(SUBSCRIPTION_LIMIT_KEY, limit);
