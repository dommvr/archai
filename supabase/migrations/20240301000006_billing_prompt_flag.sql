-- ============================================================
-- Billing prompt dismissal flag
-- Migration: 20240301000006_billing_prompt_flag.sql
--
-- Adds a nullable timestamp to user_profiles to track whether the
-- first-sign-in billing continuation modal has been dismissed.
--
-- Logic used by the app:
--   plan_intent = 'premium' AND billing_prompt_dismissed_at IS NULL
--   → show the billing continuation modal once after email verification
--
-- When the user clicks "Maybe later" or "Continue to billing", the
-- dashboard calls dismissBillingPrompt() which writes now() here.
-- The modal is never shown again for this user.
--
-- TODO: replace billing_prompt_dismissed_at with a full subscription
--       status column (e.g. subscription_status: 'trialing' | 'active' | 'cancelled')
--       once Stripe / payment provider is integrated.
-- ============================================================

alter table public.user_profiles
  add column if not exists billing_prompt_dismissed_at timestamptz;
