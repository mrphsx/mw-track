import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { TrackingEvent, TrackingPixel } from '@prisma/client';
import { PixelProvider, PixelSendResult } from './providers/pixel.provider.interface';

@Injectable()
export class TikTokEventsService implements PixelProvider {
  private readonly logger = new Logger(TikTokEventsService.name);
  private readonly baseUrl = 'https://business-api.tiktok.com/open_api/v1.3';

  private readonly eventMap: Record<string, string> = {
    PageView: 'ViewContent',
    Lead: 'SubmitForm',
    Subscribe: 'Subscribe',
    Purchase: 'CompletePayment',
    InitiateCheckout: 'InitiateCheckout',
  };

  async sendEvent(event: TrackingEvent, pixel: TrackingPixel): Promise<PixelSendResult> {
    try {
      const payload = event.payload as Record<string, unknown>;
      const ttEventName = this.eventMap[event.eventName] || event.eventName;

      const userData: Record<string, unknown> = {
        ip: payload.ipAddress,
        user_agent: payload.userAgent,
      };
      if (payload.ttclid) userData.ttclid = payload.ttclid;
      if (payload.email) userData.email = sha256(String(payload.email).toLowerCase().trim());
      if (payload.phone) userData.phone_number = sha256(String(payload.phone).replace(/\D/g, ''));

      const body = {
        pixel_code: pixel.pixelId,
        event: ttEventName,
        event_id: event.eventId,
        timestamp: new Date(event.eventTime).toISOString(),
        context: {
          page: { url: payload.pageUrl },
          user_agent: payload.userAgent,
          ip: payload.ipAddress,
        },
        properties:
          event.eventName === 'Purchase'
            ? { value: payload.value, currency: payload.currency || 'USD', order_id: payload.orderId }
            : {},
        user: userData,
      };

      const response = await fetch(`${this.baseUrl}/pixel/track/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Access-Token': pixel.accessToken },
        body: JSON.stringify({ data: [body] }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const message = errBody?.message || `HTTP ${response.status}`;
        this.logger.error(`TikTok Events error for pixel ${pixel.id} (project ${pixel.projectId}): ${message}`);
        return { success: false, error: message };
      }

      return { success: true };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`TikTok Events error for pixel ${pixel.id} (project ${pixel.projectId}): ${message}`);
      return { success: false, error: message };
    }
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
