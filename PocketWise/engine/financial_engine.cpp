#include "financial_engine.h"

/*
 * PocketWise Alpha 1 financial kernel.
 * No DOM, storage, locale, filesystem, or network dependencies.
 * All monetary values cross the boundary as integer paise.
 */

extern "C" unsigned char __heap_base;

namespace {
static unsigned int heap_cursor = 0;
static const unsigned int MAX_ROWS = 1000000U;
static const unsigned int MAX_SPLIT = 200U;
static const long long MAX_SAFE_MINOR = 9007199254740991LL;
static const int TYPE_INCOME = 1;
static const int TYPE_EXPENSE = 2;
static const int TYPE_REFUND = 3;
static const int TYPE_BORROWED = 4;
static const int TYPE_LENT = 5;
static const int TYPE_REPAY_IN = 6;
static const int TYPE_REPAY_OUT = 7;
static const int TYPE_TRANSFER = 8;

bool addChecked(long long &target, long long value) {
  long long result = 0;
#if defined(__has_builtin)
#if __has_builtin(__builtin_add_overflow)
  if (__builtin_add_overflow(target, value, &result)) return false;
  target = result;
  return true;
#endif
#endif
  if ((value > 0 && target > 9223372036854775807LL - value) ||
      (value < 0 && target < (-9223372036854775807LL - 1LL) - value)) return false;
  target += value;
  return true;
}

bool subtractChecked(long long &target, long long value) {
  if (value == (-9223372036854775807LL - 1LL)) return false;
  return addChecked(target, -value);
}

bool validTotal(long long total) {
  return total >= 0 && total <= MAX_SAFE_MINOR;
}

bool safeResult(long long value) {
  return value >= -MAX_SAFE_MINOR && value <= MAX_SAFE_MINOR;
}

bool addTo(PWFinancialResult *out, unsigned int index, long long value) {
  return addChecked(out->values[index], value);
}


bool multiplyDivideRound(long long amount, unsigned int numerator,
                         unsigned int denominator, long long &output) {
  if (amount < 0 || !denominator) return false;
  const long long quotient = amount / (long long)denominator;
  const long long remainder = amount % (long long)denominator;
  if (numerator && quotient > MAX_SAFE_MINOR / (long long)numerator) return false;
  const long long whole = quotient * (long long)numerator;
  const unsigned long long partial = (unsigned long long)remainder * numerator;
  const unsigned long long rounded = (partial + denominator / 2U) / denominator;
  if (rounded > (unsigned long long)MAX_SAFE_MINOR || whole > MAX_SAFE_MINOR - (long long)rounded) return false;
  output = whole + (long long)rounded;
  return true;
}

}

extern "C" unsigned int pw_alloc(unsigned int size) {
  if (size == 0U) size = 1U;
  if (heap_cursor == 0U) {
    const unsigned int base = (unsigned int)(unsigned long)&__heap_base;
    heap_cursor = (base + 7U) & ~7U;
  }
  const unsigned int aligned = (size + 7U) & ~7U;
  if (aligned < size || heap_cursor > 0xFFFFFFFFU - aligned) return 0U;
  const unsigned int result = heap_cursor;
  heap_cursor += aligned;
  return result;
}

extern "C" void pw_reset(void) {
  heap_cursor = 0U;
}

extern "C" int pw_aggregate(const PWTransactionInput *transactions,
                              unsigned int count,
                              PWFinancialResult *result) {
  if (!result || (count > 0U && !transactions) || count > MAX_ROWS) return 1;
  for (unsigned int i = 0; i < 23U; ++i) result->values[i] = 0LL;
  result->transaction_count = count;
  result->status = 0U;

  for (unsigned int i = 0; i < count; ++i) {
    const PWTransactionInput &tx = transactions[i];
    const long long amount = tx.amount_minor;
    bool ok = true;

    switch (tx.type_code) {
      case TYPE_INCOME:
        ok = addTo(result, 0U, amount) && addTo(result, 7U, amount) && addTo(result, 8U, amount);
        if (tx.cash_flow_bucket == 1) ok = ok && addTo(result, 9U, amount);
        else ok = ok && addTo(result, 10U, amount);
        break;
      case TYPE_EXPENSE:
        ok = addTo(result, 1U, amount) && subtractChecked(result->values[7U], amount) && subtractChecked(result->values[8U], amount);
        if (tx.cash_flow_bucket == 4) ok = ok && addTo(result, 16U, amount);
        else if (tx.cash_flow_bucket == 5) ok = ok && addTo(result, 17U, amount);
        else if (tx.cash_flow_bucket == 6) ok = ok && addTo(result, 18U, amount);
        else ok = ok && addTo(result, 15U, amount);
        break;
      case TYPE_REFUND:
        ok = addTo(result, 2U, amount) && addTo(result, 7U, amount) && addTo(result, 8U, amount) && addTo(result, 11U, amount);
        break;
      case TYPE_BORROWED:
        ok = addTo(result, 3U, amount) && addTo(result, 8U, amount) && addTo(result, 13U, amount);
        break;
      case TYPE_LENT:
        ok = addTo(result, 4U, amount) && subtractChecked(result->values[8U], amount) && addTo(result, 20U, amount);
        break;
      case TYPE_REPAY_IN:
        ok = addTo(result, 5U, amount) && addTo(result, 8U, amount) && addTo(result, 12U, amount);
        break;
      case TYPE_REPAY_OUT:
        ok = addTo(result, 6U, amount) && subtractChecked(result->values[8U], amount) && addTo(result, 19U, amount);
        break;
      case TYPE_TRANSFER:
        ok = addTo(result, 22U, amount);
        break;
      default:
        /* Unknown transaction types remain counted, matching the JS API. */
        break;
    }

    if (!ok) {
      result->status = 2U;
      return 2;
    }
  }

  return 0;
}

extern "C" int pw_equal_split(long long total_minor, unsigned int count, long long *output) {
  if (!output || !validTotal(total_minor) || count < 1U || count > MAX_SPLIT) return 1;
  const long long base = total_minor / (long long)count;
  const unsigned int remainder = (unsigned int)(total_minor % (long long)count);
  for (unsigned int i = 0; i < count; ++i) output[i] = base + (i < remainder ? 1LL : 0LL);
  return 0;
}

extern "C" int pw_percentage_split(long long total_minor, const int *basis_points,
                                      unsigned int count, long long *output) {
  if (!output || !basis_points || !validTotal(total_minor) || count < 1U || count > MAX_SPLIT) return 1;
  int remainders[MAX_SPLIT];
  bool awarded[MAX_SPLIT];
  long long basis_total = 0;
  long long floor_total = 0;
  for (unsigned int i = 0; i < count; ++i) {
    if (basis_points[i] < 0 || basis_points[i] > 10000) return 2;
    basis_total += basis_points[i];
    if (basis_total > 10000LL) return 3;
    const long long quotient = total_minor / 10000LL;
    const long long remainder = total_minor % 10000LL;
    const long long fractional = remainder * (long long)basis_points[i];
    output[i] = quotient * (long long)basis_points[i] + fractional / 10000LL;
    remainders[i] = (int)(fractional % 10000LL);
    awarded[i] = false;
    if (!addChecked(floor_total, output[i])) return 4;
  }
  if (basis_total != 10000LL) return 3;
  const long long remaining = total_minor - floor_total;
  if (remaining < 0 || remaining > (long long)count) return 4;
  for (long long unit = 0; unit < remaining; ++unit) {
    unsigned int best = count;
    for (unsigned int i = 0; i < count; ++i) {
      if (awarded[i]) continue;
      if (best == count || remainders[i] > remainders[best]) best = i;
    }
    if (best == count) return 4;
    ++output[best];
    awarded[best] = true;
  }
  return 0;
}

extern "C" int pw_amount_split(long long total_minor, const long long *amounts,
                                  unsigned int count, long long *output) {
  if (!output || !amounts || !validTotal(total_minor) || count < 1U || count > MAX_SPLIT) return 1;
  long long sum = 0;
  for (unsigned int i = 0; i < count; ++i) {
    if (amounts[i] < 0 || amounts[i] > MAX_SAFE_MINOR) return 2;
    if (!addChecked(sum, amounts[i]) || sum > MAX_SAFE_MINOR) return 3;
    output[i] = amounts[i];
  }
  return sum == total_minor ? 0 : 4;
}

extern "C" int pw_sum_minor(const long long *values, unsigned int count, long long *output) {
  if (!output || (count > 0U && !values) || count > MAX_ROWS) return 1;
  long long sum = 0;
  for (unsigned int i = 0; i < count; ++i) {
    if (!addChecked(sum, values[i]) || !safeResult(sum)) return 2;
  }
  *output = sum;
  return 0;
}

extern "C" int pw_cash_delta_minor(long long amount_minor, int type_code, long long *output) {
  if (!output) return 1;
  long long delta = 0;
  switch (type_code) {
    case TYPE_INCOME: case TYPE_REFUND: case TYPE_BORROWED: case TYPE_REPAY_IN:
      delta = amount_minor; break;
    case TYPE_EXPENSE: case TYPE_LENT: case TYPE_REPAY_OUT:
      if (amount_minor == (-9223372036854775807LL - 1LL)) return 2;
      delta = -amount_minor; break;
    default:
      delta = 0; break;
  }
  if (!safeResult(delta)) return 2;
  *output = delta;
  return 0;
}

extern "C" int pw_account_balance(long long opening_minor, const PWBalanceInput *rows,
                                     unsigned int count, long long *output) {
  if (!output || (count > 0U && !rows) || count > MAX_ROWS || !safeResult(opening_minor)) return 1;
  long long balance = opening_minor;
  for (unsigned int i = 0; i < count; ++i) {
    const PWBalanceInput &row = rows[i];
    const bool from_account = (row.flags & 1U) != 0U;
    const bool to_account = (row.flags & 2U) != 0U;
    bool ok = true;
    if (row.type_code == TYPE_TRANSFER) {
      if (from_account) ok = subtractChecked(balance, row.amount_minor);
      if (ok && to_account) ok = addChecked(balance, row.amount_minor);
    } else if (from_account) {
      switch (row.type_code) {
        case TYPE_INCOME: case TYPE_REFUND: case TYPE_BORROWED: case TYPE_REPAY_IN:
          ok = addChecked(balance, row.amount_minor); break;
        case TYPE_EXPENSE: case TYPE_LENT: case TYPE_REPAY_OUT:
          ok = subtractChecked(balance, row.amount_minor); break;
        default: break;
      }
    }
    if (!ok || !safeResult(balance)) return 2;
  }
  *output = balance;
  return 0;
}

extern "C" int pw_debt_remaining(long long original_minor, const long long *repayments,
                                    unsigned int count, long long *output) {
  if (!output || (count > 0U && !repayments) || count > MAX_ROWS || !safeResult(original_minor)) return 1;
  long long remaining = original_minor;
  for (unsigned int i = 0; i < count; ++i) {
    if (!subtractChecked(remaining, repayments[i]) || !safeResult(remaining)) return 2;
  }
  *output = remaining > 0 ? remaining : 0;
  return 0;
}


extern "C" int pw_salary_allocate(long long base_minor, long long per_cycle_base_minor,
                                    unsigned int pay_cycles, unsigned int per_cycle_percent_denominator,
                                    const PWSalaryInput *rules, unsigned int count, PWSalaryOutput *outputs,
                                    long long *summary) {
  if (!summary || (count && (!rules || !outputs)) || count > 1000U ||
      base_minor < 0 || per_cycle_base_minor < 0 || !safeResult(base_minor) || !safeResult(per_cycle_base_minor) ||
      pay_cycles > 520U || per_cycle_percent_denominator < 10000U || per_cycle_percent_denominator > 5200000U) return 1;
  long long allocated = 0, fixed = 0, percentage = 0;
  for (unsigned int i = 0; i < count; ++i) {
    const PWSalaryInput &rule = rules[i];
    long long per_cycle = 0, period = 0;
    if (rule.mode_code == 1) {
      if (rule.value_scaled < -100000000LL || rule.value_scaled > 100000000LL || !addChecked(percentage, rule.value_scaled)) return 2;
      const unsigned int percent = rule.value_scaled > 0 ? (unsigned int)rule.value_scaled : 0U;
      if (!multiplyDivideRound(base_minor, percent, 10000U, period) ||
          !multiplyDivideRound(per_cycle_base_minor, percent, per_cycle_percent_denominator, per_cycle)) return 2;
    } else if (rule.mode_code == 0) {
      if (rule.value_scaled < 0 || !safeResult(rule.value_scaled)) return 2;
      per_cycle = rule.value_scaled;
      if (per_cycle > 0 && (long long)pay_cycles > MAX_SAFE_MINOR / per_cycle) return 2;
      period = per_cycle * (long long)pay_cycles;
      if (!addChecked(fixed, period)) return 2;
    } else return 1;
    if (!addChecked(allocated, period) || !safeResult(allocated)) return 2;
    outputs[i].period_minor = period;
    outputs[i].per_cycle_minor = per_cycle;
  }
  if (!safeResult(fixed)) return 2;
  summary[0] = allocated;
  summary[1] = fixed;
  summary[2] = percentage;
  return 0;
}

extern "C" int pw_category_buckets(const PWCategoryBucketInput *rows,
                                      unsigned int count, unsigned int group_count,
                                      unsigned int bucket_count, long long *output) {
  if (!output || (count && !rows) || count > MAX_ROWS || group_count > 5000U ||
      bucket_count < 1U || bucket_count > 12U) return 1;
  const unsigned int output_count = group_count * bucket_count * 2U;
  for (unsigned int i = 0; i < output_count; ++i) output[i] = 0LL;
  for (unsigned int i = 0; i < count; ++i) {
    const PWCategoryBucketInput &row = rows[i];
    if (row.group_index >= group_count || row.bucket_index >= bucket_count ||
        row.period_index > 1U || (row.sign != 1 && row.sign != -1)) return 1;
    long long delta = row.amount_minor;
    if (row.sign < 0) {
      if (delta == (-9223372036854775807LL - 1LL)) return 2;
      delta = -delta;
    }
    const unsigned int index = row.group_index * (bucket_count * 2U) +
                               row.period_index * bucket_count + row.bucket_index;
    if (!addChecked(output[index], delta) || !safeResult(output[index])) return 2;
  }
  return 0;
}

extern "C" int pw_cash_projection(long long opening_minor, const long long *deltas,
                                     unsigned int count, long long *output) {
  if (!output || (count && !deltas) || count > MAX_ROWS || !safeResult(opening_minor)) return 1;
  long long balance = opening_minor;
  long long minimum = balance;
  long long first_shortage = 0;
  long long first_index = -1;
  long long minimum_index = -1;
  for (unsigned int i = 0; i < count; ++i) {
    if (!addChecked(balance, deltas[i]) || !safeResult(balance)) return 2;
    if (balance < minimum) { minimum = balance; minimum_index = (long long)i; }
    if (balance < 0 && first_index < 0) {
      if (balance == (-9223372036854775807LL - 1LL)) return 2;
      first_shortage = -balance;
      first_index = (long long)i;
    }
  }
  output[0] = balance;
  output[1] = minimum;
  output[2] = first_shortage;
  output[3] = first_index;
  output[4] = minimum_index;
  return 0;
}

extern "C" int pw_ratio_round_minor(long long amount_minor, unsigned int numerator,
                                       unsigned int denominator, long long *output) {
  if (!output || !safeResult(amount_minor) || amount_minor < 0 || !denominator ||
      numerator > 4000000000U || denominator > 5200000U) return 1;
  long long value = 0;
  if (!multiplyDivideRound(amount_minor, numerator, denominator, value)) return 2;
  *output = value;
  return 0;
}

/* Freestanding byte helper required by some optimizing compiler builds. */
extern "C" void *memset(void *destination, int value, unsigned long size) {
  unsigned char *bytes = (unsigned char *)destination;
  for (unsigned long i = 0; i < size; ++i) bytes[i] = (unsigned char)value;
  return destination;
}
