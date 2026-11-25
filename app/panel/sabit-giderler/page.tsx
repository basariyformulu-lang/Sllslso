'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, CheckCircle2, Pencil, X } from 'lucide-react';
import {
  formatCurrencyTRY,
  formatDateTR,
  getIstanbulMonthBounds,
  getIstanbulTodayISO,
} from '@/lib/format';
import { StatusText } from '@/components/ui/StatusText';
import { useToast } from '@/components/ToastProvider';
import type { RecurringExpense, RecurringExpensePeriod } from '@/lib/types';

const CATEGORIES = [
  'Kira',
  'Elektrik',
  'Su',
  'İnternet',
  'Personel',
  'Muhasebe Ücreti',
  'Diğer',
] as const;

const FREQ_LABELS: Record<string, string> = {
  monthly: 'Her Ay',
  quarterly: '3 Ayda Bir',
  yearly: 'Yılda Bir',
};

export default function RecurringExpensesPage() {
  const { showToast } = useToast();
  const { year: curYear, month: curMonth } = getIstanbulMonthBounds();

  const [selectedYear, setSelectedYear] = useState(curYear);
  const [selectedMonth, setSelectedMonth] = useState(curMonth);
  const [cards, setCards] = useState<RecurringExpense[]>([]);
  const [periods, setPeriods] = useState<RecurringExpensePeriod[]>([]);
  const [paidHistory, setPaidHistory] = useState<RecurringExpensePeriod[]>([]);
  const [plannedTotal, setPlannedTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [cardModal, setCardModal] = useState(false);
  const [editingCard, setEditingCard] = useState<RecurringExpense | null>(null);
  const [payPeriodTarget, setPayPeriodTarget] = useState<RecurringExpensePeriod | null>(null);
  const [saving, setSaving] = useState(false);

  const [cardForm, setCardForm] = useState({
    category: 'Kira' as (typeof CATEGORIES)[number],
    title: '',
    monthlyAmount: '',
    startDate: getIstanbulTodayISO(),
    endDate: '',
    paymentDay: '1',
    frequency: 'monthly' as 'monthly' | 'quarterly' | 'yearly',
    description: '',
    isActive: true,
  });

  const [payForm, setPayForm] = useState({
    paidAmount: '',
    paidDate: getIstanbulTodayISO(),
    paymentMethod: 'banka' as 'nakit' | 'banka' | 'kart' | 'diger',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/panel/recurring?year=${selectedYear}&month=${selectedMonth}`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCards(data.cards ?? []);
      setPeriods(data.periods ?? []);
      setPaidHistory(data.paidHistory ?? []);
      setPlannedTotal(data.plannedMonthlyTotal ?? 0);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Sabit giderler yüklenemedi', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedMonth, showToast]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadData();
    });
    return () => {
      active = false;
    };
  }, [loadData]);

  async function handleSaveCard(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/panel/recurring', {
        method: editingCard ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          editingCard
            ? {
                action: 'update_card',
                id: editingCard.id,
                category: cardForm.category,
                title: cardForm.title,
                monthlyAmount: Number(cardForm.monthlyAmount),
                paymentDay: Number(cardForm.paymentDay),
                endDate: cardForm.endDate || null,
                description: cardForm.description,
                isActive: cardForm.isActive,
              }
            : {
                category: cardForm.category,
                title: cardForm.title,
                monthlyAmount: Number(cardForm.monthlyAmount),
                startDate: cardForm.startDate,
                endDate: cardForm.endDate || null,
                paymentDay: Number(cardForm.paymentDay),
                frequency: cardForm.frequency,
                description: cardForm.description,
              }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Sabit gider kaydedilemedi', 'error');
        return;
      }
      showToast(
        editingCard ? 'Sabit gider kartı güncellendi' : 'Sabit gider kartı eklendi',
        'success'
      );
      setCardModal(false);
      setEditingCard(null);
      loadData();
    } finally {
      setSaving(false);
    }
  }

  async function handlePayPeriod(e: React.FormEvent) {
    e.preventDefault();
    if (!payPeriodTarget) return;
    setSaving(true);
    try {
      const res = await fetch('/api/panel/recurring', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'pay_period',
          periodId: payPeriodTarget.id,
          paidAmount: Number(payForm.paidAmount),
          paidDate: payForm.paidDate,
          paymentMethod: payForm.paymentMethod,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Sabit gider ödenemedi', 'error');
        return;
      }
      showToast(
        'Sabit gider ödendi olarak kaydedildi',
        'success',
        'Gerçekleşen gider kaydı otomatik oluşturuldu.'
      );
      setPayPeriodTarget(null);
      loadData();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Sabit Gider Yönetimi</h1>
          <p className="mt-1 text-sm text-slate-600">
            Aylık planlanan sabit gider yükü ve dönem bazlı gerçekleşen ödemeler
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingCard(null);
            setCardForm({
              category: 'Kira',
              title: '',
              monthlyAmount: '',
              startDate: getIstanbulTodayISO(),
              endDate: '',
              paymentDay: '1',
              frequency: 'monthly',
              description: '',
              isActive: true,
            });
            setCardModal(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-[#0F2942] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#173B5E]"
        >
          <Plus className="h-4 w-4" />
          <span>Yeni Sabit Gider Kartı</span>
        </button>
      </div>

      {/* Aylık Sabit Gider Özeti */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Planlanan Toplam Aylık Sabit Gider Yükü (Aktif Kartlar)
          </p>
          <p className="mt-1.5 font-mono text-2xl font-bold text-[#0F2942] tabular-nums">
            {formatCurrencyTRY(plannedTotal)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Bu tutar planlanan aylık yükü gösterir; yalnızca “Ödendi” işlemi yaptığınızda gerçek
            gider olarak işlenir.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium"
          >
            {[
              'Ocak',
              'Şubat',
              'Mart',
              'Nisan',
              'Mayıs',
              'Haziran',
              'Temmuz',
              'Ağustos',
              'Eylül',
              'Ekim',
              'Kasım',
              'Aralık',
            ].map((mName, idx) => (
              <option key={mName} value={idx + 1}>
                {mName}
              </option>
            ))}
          </select>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs font-medium"
          >
            {[curYear - 1, curYear, curYear + 1].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Seçili Ayın Ödeme Planı */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">
            {String(selectedMonth).padStart(2, '0')}.{selectedYear} Dönemi Sabit Gider Planı
          </h2>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 rounded bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : periods.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Bu ay için planlanmış sabit gider dönemi bulunmuyor.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Gider Adı</th>
                  <th className="px-4 py-3 font-semibold">Kategori</th>
                  <th className="px-4 py-3 font-semibold">Son Ödeme Günü</th>
                  <th className="px-4 py-3 text-right font-semibold">Planlanan Tutar</th>
                  <th className="px-4 py-3 text-right font-semibold">Ödenen Tutar</th>
                  <th className="px-4 py-3 font-semibold">Durum</th>
                  <th className="px-4 py-3 text-right font-semibold">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {periods.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {p.recurring_expense?.title ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {p.recurring_expense?.category ?? '—'}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums">{formatDateTR(p.due_date)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatCurrencyTRY(p.planned_amount)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-emerald-700">
                      {p.paid_amount ? formatCurrencyTRY(p.paid_amount) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText
                        label={
                          p.status === 'paid'
                            ? `Ödendi (${formatDateTR(p.paid_date)})`
                            : 'Ödeme Bekliyor'
                        }
                        tone={p.status === 'paid' ? 'success' : 'warning'}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {p.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => {
                            setPayPeriodTarget(p);
                            setPayForm({
                              paidAmount: String(p.planned_amount),
                              paidDate: getIstanbulTodayISO(),
                              paymentMethod: 'banka',
                            });
                          }}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-800"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Ödendi</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sabit Gider Kartları */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Tanımlı Sabit Gider Kartları</h2>
        {cards.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            Henüz sabit gider kartı oluşturulmamış (örn. Kira, Elektrik, Su, İnternet).
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <div
                key={card.id}
                className="rounded-xl border border-slate-200 p-4 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-slate-500">{card.category}</p>
                      <h3 className="text-sm font-semibold text-slate-900">{card.title}</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCard(card);
                        setCardForm({
                          category: card.category,
                          title: card.title,
                          monthlyAmount: String(card.monthly_amount),
                          startDate: card.start_date,
                          endDate: card.end_date ?? '',
                          paymentDay: String(card.payment_day),
                          frequency: card.frequency,
                          description: card.description,
                          isActive: card.is_active,
                        });
                        setCardModal(true);
                      }}
                      className="rounded p-1 text-slate-500 hover:bg-slate-100"
                      title="Düzenle"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="mt-3 font-mono text-lg font-bold text-[#0F2942] tabular-nums">
                    {formatCurrencyTRY(card.monthly_amount)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {FREQ_LABELS[card.frequency]} · Her ayın {card.payment_day}. günü
                  </p>
                </div>
                <div className="mt-3 border-t border-slate-100 pt-2.5 flex items-center justify-between text-xs">
                  <StatusText
                    label={card.is_active ? 'Aktif' : 'Pasif'}
                    tone={card.is_active ? 'success' : 'neutral'}
                  />
                  <span className="text-slate-400 font-mono tabular-nums">
                    Başlangıç: {formatDateTR(card.start_date)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Gerçekleşen Sabit Gider Geçmişi */}
      {paidHistory.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">
              Gerçekleşen Sabit Gider Ödemeleri
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Dönem</th>
                  <th className="px-4 py-2.5 font-semibold">Gider</th>
                  <th className="px-4 py-2.5 font-semibold">Ödeme Tarihi</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Ödenen Tutar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paidHistory.map((h) => (
                  <tr key={h.id}>
                    <td className="px-4 py-2.5 font-mono tabular-nums">
                      {String(h.period_month).padStart(2, '0')}.{h.period_year}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">
                      {h.recurring_expense?.title} ({h.recurring_expense?.category})
                    </td>
                    <td className="px-4 py-2.5 font-mono tabular-nums">
                      {formatDateTR(h.paid_date)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900 tabular-nums">
                      {formatCurrencyTRY(h.paid_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Kart Ekle / Düzenle Modal */}
      {cardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                {editingCard ? 'Sabit Gider Kartını Düzenle' : 'Yeni Sabit Gider Kartı'}
              </h3>
              <button type="button" onClick={() => setCardModal(false)} className="p-1 text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveCard} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Kategori *</label>
                  <select
                    value={cardForm.category}
                    onChange={(e) =>
                      setCardForm({
                        ...cardForm,
                        category: e.target.value as (typeof CATEGORIES)[number],
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Gider Adı *</label>
                  <input
                    type="text"
                    required
                    value={cardForm.title}
                    onChange={(e) => setCardForm({ ...cardForm, title: e.target.value })}
                    placeholder="Örn: Dükkan Kirası"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Aylık Tutar (TL) *
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={cardForm.monthlyAmount}
                    onChange={(e) => setCardForm({ ...cardForm, monthlyAmount: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Ödeme Günü (1-31)</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    required
                    value={cardForm.paymentDay}
                    onChange={(e) => setCardForm({ ...cardForm, paymentDay: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {!editingCard && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Başlangıç Tarihi *
                    </label>
                    <input
                      type="date"
                      required
                      value={cardForm.startDate}
                      onChange={(e) => setCardForm({ ...cardForm, startDate: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Tekrar Sıklığı</label>
                    <select
                      value={cardForm.frequency}
                      onChange={(e) =>
                        setCardForm({
                          ...cardForm,
                          frequency: e.target.value as typeof cardForm.frequency,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="monthly">Her Ay</option>
                      <option value="quarterly">3 Ayda Bir</option>
                      <option value="yearly">Yılda Bir</option>
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Bitiş Tarihi (İsteğe Bağlı)
                </label>
                <input
                  type="date"
                  value={cardForm.endDate}
                  onChange={(e) => setCardForm({ ...cardForm, endDate: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Açıklama</label>
                <input
                  type="text"
                  value={cardForm.description}
                  onChange={(e) => setCardForm({ ...cardForm, description: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              {editingCard && (
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={cardForm.isActive}
                    onChange={(e) => setCardForm({ ...cardForm, isActive: e.target.checked })}
                  />
                  <span>Sabit Gider Kartı Aktif (Eski ödenmiş dönem tutarları değişmez)</span>
                </label>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setCardModal(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#0F2942] px-5 py-2 text-xs font-semibold text-white"
                >
                  {saving ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Ödendi Modal */}
      {payPeriodTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-semibold text-slate-900">Sabit Gider Ödemesi Kaydet</h3>
              <button
                type="button"
                onClick={() => setPayPeriodTarget(null)}
                className="p-1 text-slate-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handlePayPeriod} className="mt-4 space-y-4">
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs">
                <p className="font-semibold text-slate-900">
                  {payPeriodTarget.recurring_expense?.title} (
                  {String(payPeriodTarget.period_month).padStart(2, '0')}.
                  {payPeriodTarget.period_year})
                </p>
                <p className="mt-1 text-slate-600">
                  Bu işlem gerçekleşen gider kaydı oluşturur ve bu dönem tekrar ödenemez.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Ödenen Tutar (TL) *
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={payForm.paidAmount}
                    onChange={(e) => setPayForm({ ...payForm, paidAmount: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Ödeme Tarihi *</label>
                  <input
                    type="date"
                    required
                    value={payForm.paidDate}
                    onChange={(e) => setPayForm({ ...payForm, paidDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Ödeme Yöntemi</label>
                <select
                  value={payForm.paymentMethod}
                  onChange={(e) =>
                    setPayForm({
                      ...payForm,
                      paymentMethod: e.target.value as typeof payForm.paymentMethod,
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="banka">Banka / EFT</option>
                  <option value="nakit">Nakit</option>
                  <option value="kart">Kredi / Banka Kartı</option>
                  <option value="diger">Diğer</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPayPeriodTarget(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-emerald-700 px-5 py-2 text-xs font-semibold text-white"
                >
                  {saving ? 'Kaydediliyor...' : 'Ödemeyi Onayla'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
