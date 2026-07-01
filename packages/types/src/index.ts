export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  ADVERTISER = 'ADVERTISER',
}

export enum ChannelType {
  TELEGRAM = 'TELEGRAM',
  WHATSAPP = 'WHATSAPP',
  INSTAGRAM = 'INSTAGRAM',
  VIBER = 'VIBER',
  EMAIL = 'EMAIL',
}

export enum TrackingEvent {
  PAGE_VIEW = 'PageView',
  LEAD = 'Lead',
  SUBSCRIBE = 'Subscribe',
  PURCHASE = 'Purchase',
  INITIATE_CHECKOUT = 'InitiateCheckout',
}

export enum PushStatus {
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  SENDING = 'SENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

export enum SubscriptionPlan {
  TRIAL = 'TRIAL',
  STARTER = 'STARTER',
  GROWTH = 'GROWTH',
  SCALE = 'SCALE',
  ENTERPRISE = 'ENTERPRISE',
}
