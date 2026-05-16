'use client';
import { useEffect, useState } from 'react';
import { Coins } from 'lucide-react';

export default function WalletBadge() {
  const [balance, setBalance] = useState<number>(0);

  async function refresh() {
    try {
      const res = await fetch('/api/wallet', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      setBalance(typeof data?.balance === 'number' ? data.balance : 0);
    } catch {
      setBalance(0);
    }
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div className="inline-flex items-center gap-2 px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-200 text-sm">
      <Coins className="w-4 h-4" /> {balance.toLocaleString()} cr
    </div>
  );
}
