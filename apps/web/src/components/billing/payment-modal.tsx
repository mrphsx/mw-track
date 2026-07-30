'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Invoice {
  id: string;
  amount: string;
  paidAmount: string | null;
  currency: string;
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  network: string | null;
  paymentAddress: string | null;
  expiresAt: string;
}

interface PaymentModalProps {
  invoiceId: string | null;
  onClose: () => void;
}

function formatCountdown(ms: number) {
  if (ms <= 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function PaymentModal({ invoiceId, onClose }: PaymentModalProps) {
  const queryClient = useQueryClient();
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [now, setNow] = useState(Date.now());

  const { data: invoice } = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: async () => (await api.get<Invoice>(`/billing/invoices/${invoiceId}`)).data,
    enabled: !!invoiceId,
    refetchInterval: (query) => (query.state.data?.status === 'PENDING' ? 15_000 : false),
  });

  const checkPayment = useMutation({
    mutationFn: () => api.post(`/billing/invoices/${invoiceId}/check`),
    onSuccess: ({ data }) => {
      queryClient.setQueryData(['invoice', invoiceId], data);
      if (data.status === 'PAID') {
        queryClient.invalidateQueries({ queryKey: ['billing', 'current'] });
        queryClient.invalidateQueries({ queryKey: ['billing', 'transactions'] });
      }
    },
  });

  useEffect(() => {
    if (invoice?.paymentAddress) QRCode.toDataURL(invoice.paymentAddress).then(setQrDataUrl);
  }, [invoice?.paymentAddress]);

  // Инвойс может перейти в PAID и фоном (BullMQ-поллер TronGrid), не только по клику
  // "Я оплатил" — баланс на дашборде должен обновиться и в этом случае.
  useEffect(() => {
    if (invoice?.status === 'PAID') {
      queryClient.invalidateQueries({ queryKey: ['billing', 'current'] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'transactions'] });
    }
  }, [invoice?.status, queryClient]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!invoice) return null;

  const msLeft = new Date(invoice.expiresAt).getTime() - now;
  const expired = invoice.status === 'EXPIRED' || (invoice.status === 'PENDING' && msLeft <= 0);

  return (
    <Dialog open={!!invoiceId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Пополнение баланса</DialogTitle>
        </DialogHeader>

        {invoice.status === 'PAID' && (
          <div className="text-center py-6 space-y-2">
            <Badge>Оплачено</Badge>
            <p className="text-sm text-muted-foreground">Баланс пополнен на {invoice.paidAmount ?? invoice.amount} USDT.</p>
            <Button onClick={onClose} className="mt-2">
              Готово
            </Button>
          </div>
        )}

        {expired && invoice.status !== 'PAID' && (
          <div className="text-center py-6 space-y-2">
            <Badge variant="destructive">Счёт просрочен</Badge>
            <p className="text-sm text-muted-foreground">Создайте новый счёт, чтобы пополнить баланс.</p>
          </div>
        )}

        {invoice.status === 'PENDING' && !expired && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="text-2xl font-bold tabular-nums">{formatCountdown(msLeft)}</div>
              <p className="text-xs text-muted-foreground">осталось на оплату</p>
            </div>

            {qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="QR" className="mx-auto w-40 h-40" />
            )}

            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Сумма (USDT {invoice.network})</div>
              <div className="font-mono font-semibold">{invoice.amount} USDT</div>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Адрес для перевода</div>
              <div className="flex gap-2">
                <code className="flex-1 text-xs bg-muted rounded-md p-2 break-all">{invoice.paymentAddress}</code>
                <Button size="icon" variant="outline" onClick={() => copyToClipboard(invoice.paymentAddress || '')}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <Button className="w-full" onClick={() => checkPayment.mutate()} disabled={checkPayment.isPending}>
              {checkPayment.isPending ? 'Проверяем...' : 'Я оплатил'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
