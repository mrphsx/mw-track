import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { TrackingEvent, TrackingPixel } from '@prisma/client';
import { PixelProvider, PixelSendResult } from './providers/pixel.provider.interface';

@Injectable()
export class FacebookCAPIService implements PixelProvider {
  private readonly logger = new Logger(FacebookCAPIService.name);
  private readonly baseUrl = 'https://graph.facebook.com/v18.0';

  async sendEvent(event: TrackingEvent, pixel: TrackingPixel): Promise<PixelSendResult> {
    try {
      const payload = event.payload as Record<string, unknown>;

      const userData: Record<string, unknown> = {};
      if (payload.email) userData.em = [sha256(String(payload.email).toLowerCase().trim())];
      if (payload.phone) userData.ph = [sha256(String(payload.phone).replace(/\D/g, ''))];
      if (payload.ipAddress) userData.client_ip_address = payload.ipAddress;
      if (payload.userAgent) userData.client_user_agent = payload.userAgent;
      if (payload.fbclid) userData.fbc = `fb.1.${Date.now()}.${payload.fbclid}`;

      const eventData: Record<string, unknown> = {
        event_name: event.eventName,
        event_time: Math.floor(new Date(event.eventTime).getTime() / 1000),
        event_id: event.eventId, // обязательно для дедупликации на стороне FB
        event_source_url: payload.pageUrl,
        action_source: payload.source === 'BROWSER' ? 'website' : 'system_generated',
        user_data: userData,
      };

      if (event.eventName === 'Purchase' && payload.value) {
        eventData.custom_data = {
          value: payload.value,
          currency: payload.currency || 'USD',
          order_id: payload.orderId,
        };
      }

      const body: Record<string, unknown> = {
        data: [eventData],
        access_token: pixel.accessToken,
      };
      if (pixel.testEventCode) body.test_event_code = pixel.testEventCode;

      const response = await fetch(`${this.baseUrl}/${pixel.pixelId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const message = errBody?.error?.message || `HTTP ${response.status}`;
        this.logger.error(`FB CAPI error for pixel ${pixel.id} (project ${pixel.projectId}): ${message}`);
        return { success: false, error: message };
      }

      const resBody = await response.json().catch(() => ({}));
      return { success: true, externalEventId: resBody?.fbtrace_id };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`FB CAPI error for pixel ${pixel.id} (project ${pixel.projectId}): ${message}`);
      return { success: false, error: message };
    }
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
