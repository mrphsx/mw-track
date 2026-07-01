import { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface StatsCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  hint?: string;
}

export function StatsCard({ label, value, icon: Icon, hint }: StatsCardProps) {
  return (
    <Card>
      <CardContent className="p-5 flex items-start justify-between">
        <div>
          <div className="text-sm text-gray-500">{label}</div>
          <div className="text-2xl font-bold mt-1">{value}</div>
          {hint && <div className="text-xs text-gray-400 mt-1">{hint}</div>}
        </div>
        <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
          <Icon className="w-4.5 h-4.5 text-blue-600" />
        </div>
      </CardContent>
    </Card>
  );
}
