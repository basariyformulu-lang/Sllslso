export type SubscriptionStatus =
  | 'active'
  | 'passive'
  | 'payment_pending'
  | 'pending_approval'
  | 'expired'
  | 'suspended';

export type PaymentMethod = 'nakit' | 'banka' | 'kart' | 'diger';

export interface SystemSettings {
  id: number;
  system_name: string;
  logo_url: string;
  hero_slogan: string;
  hero_subheadline: string;
  contact_email: string;
  contact_phone: string;
  pricing_description: string;
  terms_of_service: string;
  privacy_policy: string;
  updated_at?: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  monthly_price: number;
  duration_days: number;
  features: string[];
  is_active: boolean;
  effective_from: string;
  updated_at?: string;
}

export interface BankAccount {
  id: string;
  bank_name: string;
  iban: string;
  account_holder: string;
  description: string;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
}

export interface Business {
  id: string;
  name: string;
  business_code: string;
  owner_id: string;
  phone: string;
  email: string;
  address: string;
  subscription_status: SubscriptionStatus;
  subscription_start_at: string | null;
  subscription_end_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface BusinessMember {
  id: string;
  business_id: string;
  user_id: string;
  role_name: string;
  is_owner: boolean;
  is_active: boolean;
  permissions: string[];
  profile?: {
    id: string;
    first_name: string;
    last_name: string;
    phone: string;
    email: string;
  };
}

export interface PaymentRequest {
  id: string;
  business_id: string;
  subscription_id: string | null;
  plan_id: string;
  bank_account_id: string | null;
  bank_snapshot: {
    bank_name: string;
    iban: string;
    account_holder: string;
    description?: string;
  };
  payer_name: string;
  amount: number;
  payment_date: string;
  receipt_url: string | null;
  receipt_name: string | null;
  status: 'pending' | 'approved' | 'rejected';
  rejected_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  businesses?: {
    name: string;
    business_code: string;
    email: string;
    phone: string;
  };
}

export interface Customer {
  id: string;
  business_id: string;
  name: string;
  last_name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  opening_balance: number;
  registered_at: string;
  is_active: boolean;
  created_at: string;
  total_debt?: number;
  total_payment?: number;
  current_balance?: number;
}

export interface Supplier {
  id: string;
  business_id: string;
  company_name: string;
  contact_name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  opening_balance: number;
  is_active: boolean;
  created_at: string;
  total_debt?: number;
  total_payment?: number;
  current_balance?: number;
  overdue_debt?: number;
}

export interface CreditSale {
  id: string;
  business_id: string;
  customer_id: string;
  description: string;
  total_amount: number;
  paid_amount: number;
  sale_date: string;
  due_months: number | null;
  due_date: string;
  notes: string;
  is_cancelled: boolean;
  created_at: string;
  customer?: {
    name: string;
    last_name: string;
    phone: string;
  };
  computed_status?: 'vadesi_gelmedi' | 'vadesi_geldi' | 'kismen_tahsil' | 'tahsil_edildi' | 'gecikmis' | 'iptal';
}

export interface RecurringExpense {
  id: string;
  business_id: string;
  category: 'Kira' | 'Elektrik' | 'Su' | 'İnternet' | 'Personel' | 'Muhasebe Ücreti' | 'Diğer';
  title: string;
  monthly_amount: number;
  start_date: string;
  end_date: string | null;
  payment_day: number;
  frequency: 'monthly' | 'quarterly' | 'yearly';
  description: string;
  is_active: boolean;
  created_at: string;
}

export interface RecurringExpensePeriod {
  id: string;
  business_id: string;
  recurring_expense_id: string;
  period_year: number;
  period_month: number;
  due_date: string;
  planned_amount: number;
  paid_amount: number | null;
  paid_date: string | null;
  payment_method: PaymentMethod | null;
  status: 'pending' | 'paid' | 'skipped';
  expense_transaction_id: string | null;
  recurring_expense?: RecurringExpense;
}
