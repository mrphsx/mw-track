import { TrackingEvent, TrackingPixel } from '@prisma/client';

export interface PixelSendResult {
  success: boolean;
  error?: string;
  externalEventId?: string; // например, ID события, который вернул Facebook
}

// Один интерфейс на платформу (Facebook/TikTok/...), без if/else в TrackingProcessor —
// тот же паттерн, что ChannelProvider для каналов (см. channels/providers).
export interface PixelProvider {
  sendEvent(event: TrackingEvent, pixel: TrackingPixel): Promise<PixelSendResult>;
}
