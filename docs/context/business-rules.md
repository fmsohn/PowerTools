# Business Logic & Math Rules

## Commission Engine
- **Base Unit**: All internal math is normalized to **kWh** and **$/kWh**.
- **Margin Toggle**: UI supports [Decimal | Mils] toggle. (1 Mil = 0.001 $/kWh).
- **Structure Formulas**:
  - Upfront Annual: Usage * Margin * Split
  - Multi-Year: Usage * [Multiplier] * Margin * Split
  - % of Term: Usage * (Term/12) * Margin * [% Payout] * Split

## Safety Guardrails (Active Interception)
- **Decimal mode**: If a whole number is entered without a `.`, trigger a "Missing Decimal" warning.
- **Mils mode**: Automatically multiply input by 0.001.
- **High Margin**: Warn user if Decimal > 0.030 or Mils > 30.
- **Split Cap**: Maximum 100%. Defaults to developer-set value in `config/users.ts`.
