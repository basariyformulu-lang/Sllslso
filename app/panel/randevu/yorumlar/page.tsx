'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Star, Flag, MessageSquare, Send } from 'lucide-react';
import { PanelShell } from '@/components/PanelShell';
import { BookingReadOnlyBanner } from '@/components/BookingReadOnlyBanner';
import { StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';
import { formatDateTR } from '@/lib/format';

interface PanelReviewItem {
  id: string;
  rating: number;
  comment: string;
  business_reply: string | null;
  replied_at: string | null;
  moderation_status: 'published' | 'reported' | 'hidden';
  report_reason: string | null;
  created_at: string;
  customer_name: string;
  service_name: string;
  staff_name: string;
  appointment_date: string | null;
}

export default function BookingReviewsPage() {
  const { showToast } = useToast();
  const [reviews, setReviews] = useState<PanelReviewItem[]>([]);
  const [summary, setSummary] = useState({ totalCount: 0, averageRating: 0, reportedCount: 0 });
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [reportTarget, setReportTarget] = useState<PanelReviewItem | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/panel/booking/reviews', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) {
        setReviews(json.reviews ?? []);
        setSummary(json.summary ?? { totalCount: 0, averageRating: 0, reportedCount: 0 });
        setReadOnly(Boolean(json.readOnly));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadData();
    });
    return () => {
      active = false;
    };
  }, [loadData]);

  async function handleSendReply(e: React.FormEvent, reviewId: string) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/panel/booking/reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reply',
          reviewId,
          businessReply: replyText,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || 'Yanıt gönderilemedi', 'error');
        return;
      }
      showToast('Yanıtınız yayınlandı', 'success');
      setReplyTargetId(null);
      setReplyText('');
      await loadData();
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitReport(e: React.FormEvent) {
    e.preventDefault();
    if (!reportTarget) return;
    setBusy(true);
    try {
      const res = await fetch('/api/panel/booking/reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'report',
          reviewId: reportTarget.id,
          reportReason,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || 'Bildirim gönderilemedi', 'error');
        return;
      }
      showToast('Yorum platform yöneticisine incelenmek üzere bildirildi', 'success');
      setReportTarget(null);
      setReportReason('');
      await loadData();
    } finally {
      setBusy(false);
    }
  }

  return (
    <PanelShell>
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900 font-display">Müşteri Yorumları</h1>
          <p className="mt-1 text-xs text-slate-600">
            Tamamlanmış randevular sonrasında müşterilerinizin bıraktığı değerlendirmeleri inceleyin, yanıtlayın veya uygunsuz içerikleri platform yöneticisine bildirin.
          </p>
        </div>

        <BookingReadOnlyBanner visible={readOnly} />

        {/* Özet ve Şeffaflık Bilgilendirmesi */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <p className="text-xs text-slate-500">Ortalama Puan</p>
            <div className="mt-1.5 flex items-center gap-2">
              <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
              <span className="text-2xl font-bold text-slate-900 font-mono">
                {summary.averageRating > 0 ? `${summary.averageRating} / 5` : '—'}
              </span>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <p className="text-xs text-slate-500">Yayınlanan Yorumlar</p>
            <p className="mt-1.5 text-2xl font-bold text-slate-900 font-mono">
              {summary.totalCount}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <p className="text-xs text-slate-500">Yönetici İncelemesinde</p>
            <p className="mt-1.5 text-2xl font-bold text-amber-700 font-mono">
              {summary.reportedCount}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          Güvenilirlik ilkesi gereği müşteri yorumları ve puanları işletmeler tarafından silinemez veya değiştirilemez. Hakaret veya kural ihlali içeren yorumları inceleme için bildirebilirsiniz.
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-32 rounded-xl bg-slate-200 animate-pulse" />
            ))}
          </div>
        ) : reviews.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500">
            Henüz tamamlanmış randevu değerlendirmesi bulunmuyor.
          </div>
        ) : (
          <div className="space-y-4">
            {reviews.map((rev) => {
              const modDisplay =
                rev.moderation_status === 'hidden'
                  ? { label: 'Gizlendi (Admin)', tone: 'neutral' as const }
                  : rev.moderation_status === 'reported'
                  ? { label: 'İnceleme Bekliyor', tone: 'warning' as const }
                  : { label: 'Yayında', tone: 'success' as const };

              return (
                <div
                  key={rev.id}
                  className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <p className="text-sm font-bold text-slate-900">{rev.customer_name}</p>
                        <StatusText label={modDisplay.label} tone={modDisplay.tone} />
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {rev.service_name} · {rev.staff_name} ·{' '}
                        {rev.appointment_date ? formatDateTR(rev.appointment_date) : formatDateTR(rev.created_at)}
                      </p>
                    </div>

                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={`h-4 w-4 ${
                            star <= rev.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  <p className="text-sm leading-relaxed text-slate-700">{rev.comment}</p>

                  {rev.business_reply && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                      <p className="font-semibold text-slate-800">İşletme Yanıtınız</p>
                      <p className="mt-1 text-slate-600">{rev.business_reply}</p>
                    </div>
                  )}

                  {replyTargetId === rev.id && (
                    <form
                      onSubmit={(e) => handleSendReply(e, rev.id)}
                      className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
                    >
                      <textarea
                        rows={2}
                        required
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Müşterinize profesyonel bir yanıt yazın..."
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setReplyTargetId(null)}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600"
                        >
                          Vazgeç
                        </button>
                        <button
                          type="submit"
                          disabled={busy}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#0F2942] px-3 py-1.5 text-xs font-semibold text-white"
                        >
                          <Send className="h-3 w-3" />
                          <span>Yanıtı Yayınla</span>
                        </button>
                      </div>
                    </form>
                  )}

                  {!readOnly && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                      <button
                        type="button"
                        onClick={() => {
                          setReplyTargetId(rev.id);
                          setReplyText(rev.business_reply || '');
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        <span>{rev.business_reply ? 'Yanıtı Güncelle' : 'Yanıtla'}</span>
                      </button>

                      {rev.moderation_status === 'published' && (
                        <button
                          type="button"
                          onClick={() => {
                            setReportTarget(rev);
                            setReportReason('');
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50"
                        >
                          <Flag className="h-3.5 w-3.5" />
                          <span>Yöneticiye Bildir</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Yorum Bildirme Modal */}
      {reportTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h2 className="text-base font-bold text-slate-900">Yorumu Platform Yöneticisine Bildir</h2>
            <p className="mt-1 text-xs text-slate-600">
              Bildiriminiz platform yöneticisi tarafından incelenecek, uygunsuz görülürse yayından gizlenecektir.
            </p>

            <form onSubmit={handleSubmitReport} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Bildirim Nedeni *
                </label>
                <textarea
                  rows={3}
                  required
                  minLength={5}
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  placeholder="Örn: Hakaret, spam veya randevuyla ilgisiz yanıltıcı ifade..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReportTarget(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-amber-700 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                >
                  {busy ? 'Gönderiliyor...' : 'Bildirimi Gönder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PanelShell>
  );
}
